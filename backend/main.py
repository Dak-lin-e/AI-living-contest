import json
import os
import sqlite3
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = str(PROJECT_ROOT / "data" / "app.db")
ENV_PATH = PROJECT_ROOT / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
FSS_API_KEY = os.getenv("FSS_API_KEY", "")
FSS_API_KEYS = [value for value in (os.getenv("FSS_API_KEYS", "").split(",")) if value.strip()] or ([FSS_API_KEY] if FSS_API_KEY else [])
FSS_BASE_URL = "https://finlife.fss.or.kr/finlifeapi"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn
def init_db():
    with get_db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS scenarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assets REAL NOT NULL,
            product_name TEXT NOT NULL,
            annual_rate REAL NOT NULL,
            years INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        columns = {row[1] for row in conn.execute("PRAGMA table_info(scenarios)")}
        additions = {
            "product_id": "TEXT", "bank_name": "TEXT", "product_category": "TEXT", "user_id": "INTEGER",
            "job": "TEXT", "income_level": "TEXT", "credit_score": "INTEGER", "debt": "REAL",
            "monthly_expenses": "REAL", "savings_level": "TEXT"
        }
        for name, definition in additions.items():
            if name not in columns:
                conn.execute(f"ALTER TABLE scenarios ADD COLUMN {name} {definition}")
        conn.execute("INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (1, '게스트', 'guest@local', '')")
class ComicInput(BaseModel):
    assets: float = Field(gt=0)
    product_name: str = Field(min_length=1, max_length=300)
    bank_name: str = Field(min_length=1, max_length=200)
    product_category: str = Field(min_length=1, max_length=100)
    annual_rate: float = Field(ge=0, le=100)
    years: int = Field(ge=1, le=30)
    product_term_months: float = Field(default=0, ge=0)
    job: str = Field(min_length=1, max_length=100)
    income_level: str = Field(default="", max_length=100)
    credit_score: int = Field(ge=0, le=1000)
    debt: float = Field(default=0, ge=0)
    monthly_expenses: float = Field(ge=0)
    savings_level: str = Field(default="", max_length=100)
    product_details: dict[str, object] = {}
    house_price: float = Field(default=0, ge=0)
    mortgage_down_payment: float = Field(default=0, ge=0)
    mortgage_loan_amount: float = Field(default=0, ge=0)
    mortgage_monthly_income: float = Field(default=0, ge=0)
    mortgage_monthly_expenses: float = Field(default=0, ge=0)
    mortgage_existing_debt: float = Field(default=0, ge=0)
    rent_deposit: float = Field(default=0, ge=0)
    rent_down_payment: float = Field(default=0, ge=0)
    rent_loan_amount: float = Field(default=0, ge=0)
    rent_monthly_income: float = Field(default=0, ge=0)
    rent_monthly_expenses: float = Field(default=0, ge=0)
    credit_loan_amount: float = Field(default=0, ge=0)
    credit_monthly_income: float = Field(default=0, ge=0)
    credit_monthly_expenses: float = Field(default=0, ge=0)
    credit_existing_debt: float = Field(default=0, ge=0)
class ScenarioInput(BaseModel):
    assets: float = Field(gt=0)
    product_id: str = Field(min_length=1, max_length=300)
    product_name: str = Field(min_length=1, max_length=300)
    bank_name: str = Field(min_length=1, max_length=200)
    product_category: str = Field(min_length=1, max_length=200)
    annual_rate: float = Field(ge=0, le=100)
    years: int = Field(ge=1, le=30)
    job: str = Field(min_length=1, max_length=100)
    income_level: str = Field(default="", max_length=100)
    credit_score: int = Field(ge=0, le=1000)
    debt: float = Field(default=0, ge=0)
    monthly_expenses: float = Field(ge=0)
    savings_level: str = Field(default="", max_length=100)
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
init_db()
GUEST_USER_ID = 1
def current_user_id(authorization: str | None = None) -> int:
    return GUEST_USER_ID
def first_value(row: dict, keys: tuple[str, ...], fallback: str = "") -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return fallback
def number(value: object) -> float | None:
    try:
        import re
        match = re.search(r"-?\d+(?:\.\d+)?", str(value or "").replace(",", ""))
        return float(match.group()) if match else None
    except (TypeError, ValueError):
        return None
def request_finlife(endpoint: str, top_fin_grp_no: str) -> dict:
    if not FSS_API_KEYS:
        raise ValueError("금융감독원 API 키가 서버 설정에 없습니다.")
    last_error: Exception | None = None
    for api_key in FSS_API_KEYS:
        params = urllib.parse.urlencode({"auth": api_key.strip(), "topFinGrpNo": top_fin_grp_no, "pageNo": 1})
        request = urllib.request.Request(f"{FSS_BASE_URL}/{endpoint}?{params}", headers={"Accept": "application/json", "User-Agent": "Money-Storybook/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                payload = json.loads(response.read().decode("utf-8"))
            result = payload.get("result", {})
            if result.get("err_cd") not in (None, "000", "0000"):
                raise ValueError(result.get("err_msg", "금융감독원 응답 오류"))
            return payload
        except Exception as exc:
            last_error = exc
    raise last_error or ValueError("금융감독원 응답 오류")
def normalize_products(payload: dict, category: str) -> list[dict]:
    base_rows = payload.get("result", {}).get("baseList", [])
    option_rows = payload.get("result", {}).get("optionList", [])
    options_by_code: dict[str, list[dict]] = {}
    for option in option_rows:
        options_by_code.setdefault(str(option.get("fin_prdt_cd", "")), []).append(option)
    products = []
    for index, base in enumerate(base_rows):
        code = str(base.get("fin_prdt_cd", ""))
        options = options_by_code.get(code, [{}])
        best = max(options, key=lambda item: number(item.get("intr_rate2")) or number(item.get("intr_rate")) or 0)
        rate = number(best.get("intr_rate2")) or number(best.get("intr_rate"))
        bank = first_value(base, ("kor_co_nm", "fin_co_no"), "금융회사")
        name = first_value(base, ("fin_prdt_nm",), f"{category} 상품 {index + 1}")
        products.append({"id": f"fss-{category}-{bank}-{code or index}", "bank_name": bank, "name": name, "category": category, "annual_rate": rate, "term_months": number(best.get("save_trm") or best.get("loan_term")), "description": first_value(base, ("mtrt_int", "etc_note", "join_way", "loan_lmt", "repay_type", "lend_rate_type", "crdt_grad_avg"), "금융감독원 금융상품한눈에 공시 상품"), "rate_notice": "금융감독원 금융상품한눈에 공시 정보입니다. 가입·대출 전 금리 유형, 한도, 기간, 비용과 최신 상품설명서를 확인해 주세요.", "product_details": {**base, "대표옵션": best, "공시분류": category}})
    return products
def money_format(value: float) -> str:
    return f"{int(round(value)):,}"

def panel_glossary(index: int) -> list[dict[str, str]]:
    glossary_map = [
        [
            {"term": "자산", "meaning": "보유한 돈과 가치 있는 재산의 총합을 뜻해요."},
            {"term": "부채", "meaning": "갚아야 하는 돈으로, 생활 부담을 키울 수 있어요."},
        ],
        [
            {"term": "금리", "meaning": "돈을 맡기거나 빌릴 때 붙는 이자 비율을 말해요."},
            {"term": "우대조건", "meaning": "특정 조건을 충족하면 더 좋은 조건을 받는 항목이에요."},
        ],
        [
            {"term": "복리", "meaning": "이자에 다시 이자가 붙어 시간이 지날수록 차이가 커지는 방식이에요."},
            {"term": "자산흐름", "meaning": "돈이 들어오고 나가며 어떻게 쌓이거나 줄어드는지를 뜻해요."},
        ],
        [
            {"term": "참고용", "meaning": "현재 조건으로 보는 예상치라서 실제 계약 전에 다시 검토해야 해요."},
            {"term": "중도상환", "meaning": "계약 기간 중 일부를 미리 갚을 때 발생하는 조건과 비용을 말해요."},
        ],
    ]
    return glossary_map[index]

def build_story_panels(item: ComicInput) -> list[dict]:
    principal = float(item.assets)
    annual_rate = float(item.annual_rate)
    years = int(item.years)
    debt = float(item.debt)
    monthly_expenses = float(item.monthly_expenses)
    first_year_value = principal * (1 + annual_rate / 100)
    second_year_value = principal * (1 + annual_rate / 100) ** 2
    projected_value = principal * (1 + annual_rate / 100) ** years
    net_assets = principal - debt
    debt_detail = f"부채 {money_format(debt)}원 · " if debt > 0 else ""
    return [
        {
            "label": "구간 1",
            "title": "출발 자산과 부담",
            "headline": f"보유 자산 {money_format(principal)}원",
            "detail": f"{debt_detail}월 지출 {money_format(monthly_expenses)}원",
            "explanation": "현재 보유 자산과 부채, 고정 지출을 함께 보면 실제로 남는 여력이 얼마나 되는지 확인할 수 있습니다. 이 장면은 자산을 단순 숫자로 보는 대신 생활 여건까지 함께 살피는 이유를 보여줍니다.",
            "image_reason": "이 구간은 현재 자산, 부채, 고정 지출이 어떤 상태인지 한눈에 보이도록 큰 숫자와 지출/부채 정보를 배치해 '출발점'을 강조합니다.",
            "glossary": panel_glossary(0),
            "numbers": {"current_assets": principal, "debt": debt, "monthly_expenses": monthly_expenses},
        },
        {
            "label": "구간 2",
            "title": "상품 조건과 수익률",
            "headline": f"{item.bank_name} · {item.product_name}",
            "detail": f"공시 금리 연 {annual_rate:.2f}% · {item.product_category}",
            "explanation": "고정 금리만 보지 않고 가입 대상, 한도, 기간, 우대 조건을 같이 확인해야 합니다. 이 구간은 상품이 좋아 보이더라도 나의 상황에 맞는지 판단하는 기준을 보여줍니다.",
            "image_reason": "이 구간은 금리와 상품 조건을 시각적으로 강조해 '좋아 보이는 상품'이 실제로 나에게 맞는지를 비교하는 흐름으로 표현합니다.",
            "glossary": panel_glossary(1),
            "numbers": {"rate": annual_rate, "term_years": years, "asset_after_first_year": first_year_value},
        },
        {
            "label": "구간 3",
            "title": "시간의 흐름에 따른 자산 변화",
            "headline": f"{years}년 후 예상 자산 {money_format(projected_value)}원",
            "detail": f"1년 {money_format(first_year_value)}원 · 2년 {money_format(second_year_value)}원",
            "explanation": "복리 효과로 시간이 흐를수록 차이가 커집니다. 그러나 실제 자산 변화는 월 지출과 부채 상환을 함께 고려해야 하므로, 단순 수익률만 보고 판단하면 안 됩니다.",
            "image_reason": "시간의 흐름을 화살표와 그래프로 보여주며, 복리가 얼마나 커지는지를 시각적으로 설명해 자산이 점점 늘어나는 과정을 드러냅니다.",
            "glossary": panel_glossary(2),
            "numbers": {"projected_assets": projected_value, "year_1": first_year_value, "year_2": second_year_value},
        },
        {
            "label": "구간 4",
            "title": "최종 전망과 확인 포인트",
            "headline": f"순자산 기준 {money_format(net_assets)}원",
            "detail": f"예상 수익률 {((projected_value - principal) / principal * 100):.1f}% · 실제 계약 전 확인 필요",
            "explanation": "마지막 구간은 이 수치가 참고용이라는 점을 강조합니다. 최종 결론은 최신 금리, 비용, 중도상환 규정, 부채 관리 상황까지 다시 확인한 뒤 내려야 합니다.",
            "image_reason": "마지막 화면은 예상치와 주의사항을 함께 보여줘 '이건 참고값'이라는 점을 강조하고, 계약 전 재확인이 중요하다는 메시지를 전달합니다.",
            "glossary": panel_glossary(3),
            "numbers": {"net_assets": net_assets, "projected_assets": projected_value, "projected_gain_rate": ((projected_value - principal) / principal * 100) if principal else 0.0},
        },
    ]

@app.get("/api/health")
def health():
    return {"ok": True}
def _money(amount: float) -> int:
    return int(round(float(amount)))

_QUARTER_INTERVAL_CANDIDATES = (3, 6, 12, 24, 36, 60, 120)
def _resolve_total_months(years: int, product_term_months: float) -> int:
    if product_term_months and product_term_months > 0:
        return int(round(product_term_months))
    return max(1, int(years)) * 12
def _quarterly_months(total_months: int, max_points: int = 13) -> list[int]:
    total_months = max(1, int(round(total_months)))
    interval = _QUARTER_INTERVAL_CANDIDATES[-1]
    for candidate in _QUARTER_INTERVAL_CANDIDATES:
        if total_months // candidate + 1 <= max_points:
            interval = candidate
            break
    steps = list(range(0, total_months, interval))
    if steps[-1] != total_months:
        steps.append(total_months)
    return steps
def _month_label(month: int) -> str:
    if month <= 0:
        return "시작"
    years, rem = divmod(month, 12)
    if rem == 0:
        return f"{years}년"
    if years == 0:
        return f"{rem}개월"
    return f"{years}년 {rem}개월"

_PERIOD_METRIC_LABELS = {
    "예금": "예치 기간",
    "적금": "적립 기간",
    "주택담보대출": "대출 기간",
    "전세자금대출": "대출 기간",
    "개인신용대출": "대출 기간",
}
def _period_metric(product_type: str, total_months: int) -> dict:
    label = _PERIOD_METRIC_LABELS.get(product_type, "기간")
    years, rem = divmod(max(1, int(round(total_months))), 12)
    if rem == 0:
        return {"label": label, "value": years, "unit": "년"}
    return {"label": label, "value": int(round(total_months)), "unit": "개월"}

def _product_type(category: str) -> str:
    if '예금' in category:
        return '예금'
    if '적금' in category:
        return '적금'
    if '주택담보' in category:
        return '주택담보대출'
    if '개인신용' in category:
        return '개인신용대출'
    if '전세자금' in category:
        return '전세자금대출'
    return category or '예금'


def build_financial_coach_summary(item: ComicInput) -> dict:
    principal = float(item.assets)
    annual_rate = float(item.annual_rate)
    years = int(item.years)
    debt = float(item.debt)
    monthly_expenses = float(item.monthly_expenses)
    final_value = principal * ((1 + annual_rate / 100) ** years)
    interest = max(final_value - principal, 0.0)
    product_type = _product_type(item.product_category)
    total_months = _resolve_total_months(years, item.product_term_months)

    if product_type == '주택담보대출':
        house_price = float(item.house_price or 0)
        down_payment = float(item.mortgage_down_payment or 0)
        loan_amount = float(item.mortgage_loan_amount or max(house_price - down_payment, 0.0) or principal)
        monthly_income = float(item.mortgage_monthly_income or 0)
        monthly_expense = float(item.mortgage_monthly_expenses or monthly_expenses or 0)
        existing_debt = float(item.mortgage_existing_debt or debt or 0)
        monthly_burden = loan_amount * (annual_rate / 100) / 12
        total_interest = loan_amount * (annual_rate / 100) * years
        total_repayment = loan_amount + total_interest
        summary = f"주택가격 {money_format(house_price or loan_amount)}원 기준으로 대출금 {money_format(loan_amount)}원을 빌리면, {years}년 동안 월 부담은 약 {money_format(monthly_burden)}원이고 총이자는 약 {money_format(total_interest)}원이에요."
        key_metrics = [
            {"label": "주택가격", "value": _money(house_price or loan_amount), "unit": "원"},
            {"label": "대출 원금", "value": _money(loan_amount), "unit": "원"},
            {"label": "월 소득", "value": _money(monthly_income), "unit": "원"},
            {"label": "월 상환액", "value": _money(monthly_burden), "unit": "원"},
            {"label": "총 이자", "value": _money(total_interest), "unit": "원"},
            {"label": "기존 대출", "value": _money(existing_debt), "unit": "원"},
        ]
        visualizations = [
            {
                "type": "repayment_chart",
                "title": "월 부담 비교",
                "description": "월 소득, 월 지출, 월 상환액을 비교해 실제 부담을 쉽게 보여줘요.",
                "data": [
                    {"label": "월 소득", "value": _money(monthly_income)},
                    {"label": "월 지출", "value": _money(monthly_expense)},
                    {"label": "월 상환액", "value": _money(monthly_burden)},
                ],
            },
            {
                "type": "comparison_table",
                "title": "대출 구조",
                "description": "주택가격과 대출금, 자기자금이 어떻게 조합되는지 보여줘요.",
                "data": [
                    {"label": "주택가격", "value": _money(house_price or loan_amount)},
                    {"label": "자기자금", "value": _money(down_payment)},
                    {"label": "대출금", "value": _money(loan_amount)},
                ],
            },
        ]
        explanation = [
            "주택담보대출은 집값의 일부를 자기 돈으로 내고 나머지는 대출로 채우는 구조라서, 자기자금이 많을수록 월 부담이 줄어들 수 있어요.",
            "그래서 대출금, 월 소득, 월 지출을 함께 볼 때 실제로 매달 얼마나 부담이 되는지 더 정확히 판단할 수 있어요.",
        ]
        cautions = [
            "대출금이 크면 월 상환액도 커지기 때문에 월 소득 대비 부담을 꼭 확인해야 해요.",
            "기존 대출과 생활비까지 합치면 실제로 남는 돈이 더 적어질 수 있어요.",
        ]
        simple_terms = [
            {"term": "담보대출", "meaning": "집처럼 값나가는 것을 맡기고 그만큼 돈을 빌리는 대출이에요."},
            {"term": "총 이자", "meaning": "대출 기간 동안 추가로 내야 하는 돈을 모두 더한 금액이에요."},
        ]
    elif product_type == '개인신용대출':
        loan_amount = float(item.credit_loan_amount or principal)
        monthly_income = float(item.credit_monthly_income or 0)
        monthly_expense = float(item.credit_monthly_expenses or monthly_expenses or 0)
        existing_debt = float(item.credit_existing_debt or debt or 0)
        monthly_burden = loan_amount * (annual_rate / 100) / 12
        total_interest = loan_amount * (annual_rate / 100) * years
        total_repayment = loan_amount + total_interest
        summary = f"신용대출 {money_format(loan_amount)}원을 받는다면 {years}년 동안 월 부담은 약 {money_format(monthly_burden)}원이고, 총 이자는 약 {money_format(total_interest)}원이에요."
        key_metrics = [
            {"label": "대출금액", "value": _money(loan_amount), "unit": "원"},
            {"label": "월 소득", "value": _money(monthly_income), "unit": "원"},
            {"label": "월 지출", "value": _money(monthly_expense), "unit": "원"},
            {"label": "월 상환액", "value": _money(monthly_burden), "unit": "원"},
            {"label": "기존 대출", "value": _money(existing_debt), "unit": "원"},
        ]
        visualizations = [
            {
                "type": "repayment_chart",
                "title": "월 부담 비교",
                "description": "월 소득과 지출, 대출 상환액을 나란히 보며 부담이 어느 정도인지 보여줘요.",
                "data": [
                    {"label": "월 소득", "value": _money(monthly_income)},
                    {"label": "월 지출", "value": _money(monthly_expense)},
                    {"label": "월 상환액", "value": _money(monthly_burden)},
                ],
            },
            {
                "type": "comparison_table",
                "title": "대출과 생활비",
                "description": "개인신용대출은 생활비와 기존 부담까지 함께 보면 실질적인 여력이 보입니다.",
                "data": [
                    {"label": "대출금", "value": _money(loan_amount)},
                    {"label": "기존 대출", "value": _money(existing_debt)},
                    {"label": "총 지출", "value": _money(monthly_expense)},
                ],
            },
        ]
        explanation = [
            "개인신용대출은 집처럼 큰 담보가 없기 때문에, 월 소득과 지출을 더 세심하게 봐야 해요.",
            "대출금만 크게 보지 말고, 매달 갚아야 하는 돈과 기존 부채까지 함께 보면 현실적인 부담을 더 잘 알 수 있어요.",
        ]
        cautions = [
            "신용대출은 금리와 상환 방식이 부담을 크게 바꾸기 때문에, 월 부담이 너무 높지 않은지 꼭 확인해요.",
            "기존 대출이 많으면 새 대출이 생활에 더 큰 압박이 될 수 있어요.",
        ]
        simple_terms = [
            {"term": "신용대출", "meaning": "집이나 물건을 맡기지 않고, 내 신용만으로 빌리는 대출이에요."},
            {"term": "월 상환액", "meaning": "매달 은행에 갚아야 하는 돈이에요."},
        ]
    elif product_type == '전세자금대출':
        deposit = float(item.rent_deposit or principal)
        self_fund = float(item.rent_down_payment or 0)
        loan_amount = float(item.rent_loan_amount or max(deposit - self_fund, 0.0) or principal)
        monthly_income = float(item.rent_monthly_income or 0)
        monthly_expense = float(item.rent_monthly_expenses or monthly_expenses or 0)
        monthly_burden = loan_amount * (annual_rate / 100) / 12
        total_interest = loan_amount * (annual_rate / 100) * years
        summary = f"전세보증금 {money_format(deposit)}원 중 자기자금 {money_format(self_fund)}원을 쓰고 나머지 {money_format(loan_amount)}원은 대출로 맞추면, {years}년 동안 월 부담은 약 {money_format(monthly_burden)}원이고 총 이자는 약 {money_format(total_interest)}원 정도로 보여요."
        key_metrics = [
            {"label": "전세보증금", "value": _money(deposit), "unit": "원"},
            {"label": "자기자금", "value": _money(self_fund), "unit": "원"},
            {"label": "대출금", "value": _money(loan_amount), "unit": "원"},
            {"label": "월 소득", "value": _money(monthly_income), "unit": "원"},
            {"label": "월 상환액", "value": _money(monthly_burden), "unit": "원"},
        ]
        visualizations = [
            {
                "type": "bar_chart",
                "title": "보증금 구성",
                "description": "전세자금은 보증금에서 자기자금과 대출금이 어떻게 나뉘는지 보여줘요.",
                "data": [
                    {"label": "자기자금", "value": _money(self_fund)},
                    {"label": "대출금", "value": _money(loan_amount)},
                ],
            },
            {
                "type": "timeline",
                "title": "대출 기간 흐름",
                "description": "전세자금대출은 시간이 지날수록 이자가 붙어 부담이 커지는 구조로 보여줘요.",
                "data": [
                    {"label": _month_label(m), "value": _money(loan_amount + total_interest * (m / total_months))}
                    for m in _quarterly_months(total_months)
                ],
            },
        ]
        explanation = [
            "전세자금대출은 보증금을 전부 준비하기 어려울 때 큰 도움이 되는 구조예요.",
            "하지만 대출금이 커지면 매달 갚아야 하는 부담과 전체 이자도 함께 늘어나므로, 월 소득과 생활비를 꼭 같이 봐야 해요.",
        ]
        cautions = [
            "전세자금대출은 보증금 규모와 대출 비율이 높으면 월 부담이 커질 수 있어요.",
            "부담 가능 범위를 미리 계산해서 너무 큰 대출을 잡지 않도록 확인해야 해요.",
        ]
        simple_terms = [
            {"term": "전세보증금", "meaning": "집을 빌려 쓰는 대가로 집주인에게 맡기고, 나중에 돌려받는 큰 목돈이에요."},
            {"term": "자기자금", "meaning": "대출 없이 내가 직접 마련한 돈이에요."},
        ]
    elif product_type == '예금':
        summary = f"지금 {money_format(principal)}원을 넣으면 {years}년 뒤에는 약 {money_format(final_value)}원이 되고, 이자는 약 {money_format(interest)}원 더 붙어요."
        key_metrics = [
            {"label": "현재 예치금", "value": _money(principal), "unit": "원"},
            {"label": "예상 만기금액", "value": _money(final_value), "unit": "원"},
            {"label": "예상 이자", "value": _money(interest), "unit": "원"},
            {"label": "세후 예상 수령액", "value": _money(final_value * 0.85), "unit": "원"},
        ]
        visualizations = [
            {"type": "bar_chart", "title": "원금과 이자 구성", "description": "원금은 그대로 있고, 이자가 더 쌓이는 모습을 보여줘요.", "data": [{"label": "원금", "value": _money(principal)}, {"label": "이자", "value": _money(interest)}]},
            {"type": "comparison_table", "title": "지금과 3년 뒤", "description": "처음 넣은 돈과 나중에 받는 돈을 비교해 볼 수 있어요.", "data": [{"label": "현재", "value": _money(principal)}, {"label": "만기 예상", "value": _money(final_value)}]},
        ]
        explanation = [
            "예금은 돈을 맡겨두면 시간이 지나면서 이자가 붙어요. 그래서 처음 넣은 돈보다 나중에 더 많이 돌려받는 구조예요.",
            "쉽게 말하면, 오늘 1,000만 원을 예치하면 3년 뒤에는 원금보다 조금 더 커진 돈을 돌려받는다는 뜻이에요.",
        ]
        cautions = [
            "이자는 세금, 중도해지, 금리 변동 때문에 실제로는 조금 달라질 수 있어요.",
            "예상 금액은 참고용이니, 상품 설명서를 꼭 확인해 주세요.",
        ]
        simple_terms = [
            {"term": "세전 이자", "meaning": "세금을 떼기 전, 원래 붙는 이자 금액이에요."},
            {"term": "세후 이자", "meaning": "세금을 낸 뒤 실제로 내 손에 들어오는 이자예요."},
        ]
    elif product_type == '적금':
        summary = f"매달 조금씩 넣는 구조라면 {years}년 뒤에는 약 {money_format(final_value)}원이 되고, 이자는 약 {money_format(interest)}원 정도 더 붙어요."
        key_metrics = [
            {"label": "현재 자산 기준", "value": _money(principal), "unit": "원"},
            {"label": "예상 만기금액", "value": _money(final_value), "unit": "원"},
            {"label": "예상 이자", "value": _money(interest), "unit": "원"},
            {"label": "예상 수익률", "value": round(((final_value - principal) / principal * 100) if principal else 0.0, 1), "unit": "%"},
        ]
        visualizations = [
            {"type": "line_chart", "title": "시간이 지나면 돈이 커져요", "description": "초반에는 조금 느리게 보이지만, 시간이 지나면 자산이 점점 늘어나는 모습을 보여줘요.", "data": [
                {"label": _month_label(m), "value": _money(principal * ((1 + annual_rate / 100) ** (m / 12)))}
                for m in _quarterly_months(total_months)
            ]},
            {"type": "donut_chart", "title": "원금과 이자 비중", "description": "처음 넣은 돈과 이자가 어떤 비중인지 한눈에 볼 수 있어요.", "data": [{"label": "원금", "value": _money(principal)}, {"label": "이자", "value": _money(interest)}]},
        ]
        explanation = [
            "적금은 매달 조금씩 넣는 습관이 중요해요. 돈이 모이고, 그 돈에 또 이자가 붙으면서 점점 커지는 구조예요.",
            "그래서 한 번에 큰 돈을 넣는 것보다 꾸준히 넣는 게 더 안정적일 수 있어요.",
        ]
        cautions = [
            "적금은 중도 해지나 월 납입 조건에 따라 결과가 달라질 수 있어요.",
            "지금 예측은 현재 기준이고, 실제로는 월 납입 금액이 더 중요해요.",
        ]
        simple_terms = [
            {"term": "복리", "meaning": "이자에 또 이자가 붙어서, 시간이 지날수록 더 빠르게 불어나는 방식이에요."},
            {"term": "만기", "meaning": "정해진 기간이 끝나 돈을 돌려받을 수 있는 시점이에요."},
        ]
    else:
        total_interest = principal * (annual_rate / 100) * years
        total_payment = principal + total_interest
        summary = f"전세자금대출을 쓰면 {years}년 뒤에는 총 이자가 약 {money_format(total_interest)}원 들어가고, 전체 부담은 약 {money_format(total_payment)}원 정도로 보여요."
        key_metrics = [
            {"label": "전세보증금", "value": _money(principal), "unit": "원"},
            {"label": "대출금", "value": _money(principal), "unit": "원"},
            {"label": "예상 총 이자", "value": _money(total_interest), "unit": "원"},
            {"label": "총 부담", "value": _money(total_payment), "unit": "원"},
        ]
        visualizations = [
            {"type": "bar_chart", "title": "대출 전후의 부담 차이", "description": "보증금과 대출을 같이 쓰는 구조에서 어떤 돈이 들어오고 나가는지 보여줘요.", "data": [{"label": "본인 부담금", "value": _money(principal)}, {"label": "대출금", "value": _money(principal)}]},
            {"type": "timeline", "title": "대출 기간 동안의 흐름", "description": "시간이 지나면서 이자가 얼마나 늘어나는지 간단히 보여줘요.", "data": [
                {"label": _month_label(m), "value": _money(principal + total_interest * (m / total_months))}
                for m in _quarterly_months(total_months)
            ]},
        ]
        explanation = [
            "전세자금대출은 집을 살 때 필요한 보증금을 조금 덜 내도록 도와주는 구조예요.",
            "하지만 대출을 빌리면 이자가 붙어서, 실제로는 돈을 갚아야 하는 부담이 생긴다는 점을 꼭 알아야 해요.",
        ]
        cautions = [
            "전세자금대출도 금리, 상환 방식, 대출 만기 조건이 실제 부담을 크게 바꿔요.",
            "좋아 보이는 조건이더라도, 실제로는 월 부담이 얼마나 되는지 먼저 확인해야 해요.",
        ]
        simple_terms = [
            {"term": "전세보증금", "meaning": "집을 빌려 쓰는 대가로 집주인에게 맡기고, 나중에 돌려받는 큰 목돈이에요."},
            {"term": "총 이자", "meaning": "대출 기간 동안 추가로 내야 하는 돈을 모두 더한 금액이에요."},
        ]

    key_metrics = [*key_metrics, _period_metric(product_type, total_months)]
    return {"summary": summary, "productType": product_type, "keyMetrics": key_metrics, "visualizations": visualizations, "explanation": explanation, "cautions": cautions, "simple_terms": simple_terms}


def _normalize_ai_key_metrics(value):
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        result = []
        for label, raw in value.items():
            if isinstance(raw, dict):
                result.append({
                    "label": str(raw.get("label") or label),
                    "value": float(raw.get("value") or 0),
                    "unit": raw.get("unit") or "",
                })
            else:
                result.append({
                    "label": str(label),
                    "value": float(raw or 0),
                    "unit": "%" if isinstance(raw, (int, float)) and label.endswith("율") else "",
                })
        return result
    return []


def _normalize_ai_visualizations(value):
    if not isinstance(value, (list, dict)):
        return []
    if isinstance(value, list):
        cleaned = []
        for item in value:
            if not isinstance(item, dict):
                continue
            data = item.get("data")
            if isinstance(data, list) and data:
                cleaned.append(item)
        return cleaned
    result = []
    for label, raw in value.items():
        if not isinstance(raw, dict):
            continue
        data = raw.get("data")
        if isinstance(data, list) and data:
            result.append({
                "type": raw.get("type") or "line_chart",
                "title": raw.get("title") or label,
                "description": raw.get("description") or "",
                "data": data,
            })
    return result


def _call_openai_financial_summary(item: ComicInput) -> dict | None:
    if not OPENAI_API_KEY:
        return None
    prompt = {
        "model": "gpt-4o-mini",
        "messages": [
            {
                "role": "system",
                "content": "너는 초등학생도 이해할 수 있는 금융 가이드다. 반드시 한국어로 답하고, 결과는 JSON 객체 하나만 반환해야 한다. 키는 summary, productType, keyMetrics, visualizations, explanation, cautions, simple_terms만 사용한다. explanation은 2~3개의 짧은 문장으로, 초등학생도 이해할 수 있게 아주 쉽게 쓴다. cautions도 2~3개로 짧고 친절하게 쓴다. simple_terms는 'term'과 'meaning'을 가진 객체 배열이어야 하며, 각 용어는 월 부담, 대출금, 이자, 자산, 부채 같은 일상용어를 중심으로 설명한다. 숫자는 반드시 정수로 표기한다. 입력값을 정확히 반영해서, 실제 대출금/월 소득/생활비/기존 부채가 있으면 그 숫자를 활용해 설명한다.",
            },
            {
                "role": "user",
                "content": json.dumps({
                    "assets": item.assets,
                    "product_name": item.product_name,
                    "bank_name": item.bank_name,
                    "product_category": item.product_category,
                    "annual_rate": item.annual_rate,
                    "years": item.years,
                    "job": item.job,
                    "income_level": item.income_level,
                    "credit_score": item.credit_score,
                    "monthly_expenses": item.monthly_expenses,
                    "savings_level": item.savings_level,
                    "debt": item.debt,
                    "house_price": item.house_price,
                    "mortgage_down_payment": item.mortgage_down_payment,
                    "mortgage_loan_amount": item.mortgage_loan_amount,
                    "mortgage_monthly_income": item.mortgage_monthly_income,
                    "mortgage_monthly_expenses": item.mortgage_monthly_expenses,
                    "mortgage_existing_debt": item.mortgage_existing_debt,
                    "rent_deposit": item.rent_deposit,
                    "rent_down_payment": item.rent_down_payment,
                    "rent_loan_amount": item.rent_loan_amount,
                    "rent_monthly_income": item.rent_monthly_income,
                    "rent_monthly_expenses": item.rent_monthly_expenses,
                    "credit_loan_amount": item.credit_loan_amount,
                    "credit_monthly_income": item.credit_monthly_income,
                    "credit_monthly_expenses": item.credit_monthly_expenses,
                    "credit_existing_debt": item.credit_existing_debt,
                }, ensure_ascii=False),
            },
        ],
        "response_format": {"type": "json_object"},
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(prompt, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
        message = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
        parsed = json.loads(message)
        if not isinstance(parsed, dict):
            return None
        fallback = build_financial_coach_summary(item)
        raw_ai_metrics = _normalize_ai_key_metrics(parsed.get("keyMetrics"))
        if raw_ai_metrics:
            correct_period = _period_metric(_product_type(item.product_category), _resolve_total_months(int(item.years), item.product_term_months))
            ai_key_metrics = [m for m in raw_ai_metrics if "기간" not in str(m.get("label", ""))] + [correct_period]
        else:
            ai_key_metrics = fallback["keyMetrics"]
        normalized = {
            "summary": str(parsed.get("summary") or fallback["summary"]),
            "productType": str(parsed.get("productType") or _product_type(item.product_category)),
            "keyMetrics": ai_key_metrics,
            "visualizations": _normalize_ai_visualizations(parsed.get("visualizations")) or fallback["visualizations"],
            "explanation": parsed.get("explanation") or fallback["explanation"],
            "cautions": parsed.get("cautions") or fallback["cautions"],
            "simple_terms": parsed.get("simple_terms") or fallback.get("simple_terms") or [],
        }
        if not normalized["keyMetrics"] or not normalized["visualizations"]:
            return fallback
        return normalized
    except Exception:
        return None


@app.post("/api/ai/comic")
def create_ai_comic(item: ComicInput, authorization: str | None = Header(default=None)):
    current_user_id(authorization)
    ai_response = _call_openai_financial_summary(item)
    if ai_response is not None:
        return ai_response
    return build_financial_coach_summary(item)
@app.get("/api/products")
def list_products():
    products: list[dict] = []
    errors: list[str] = []
    sources = (("정기예금", "depositProductsSearch.json", "020000"), ("적금", "savingProductsSearch.json", "020000"), ("주택담보대출", "mortgageLoanProductsSearch.json", "020000"), ("전세자금대출", "rentHouseLoanProductsSearch.json", "020000"), ("개인신용대출", "creditLoanProductsSearch.json", "020000"))
    fallback_products = {
        "주택담보대출": [
            {"id": "fallback-mortgage-1", "bank_name": "우리은행", "name": "우리주택담보대출", "category": "주택담보대출", "annual_rate": 3.8, "term_months": 240, "description": "주택담보 대출은 집을 담보로 자금을 빌리는 상품으로, 대출금과 월 부담을 함께 확인하는 것이 중요해요.", "rate_notice": "실시간 공시가 비어 있어 교육용 기본값으로 계산하고 있습니다.", "product_details": {}},
            {"id": "fallback-mortgage-2", "bank_name": "국민은행", "name": "KB 주택담보대출", "category": "주택담보대출", "annual_rate": 4.1, "term_months": 300, "description": "자기자금과 대출금 비율을 고려하면 매달 부담을 더 쉽게 비교할 수 있어요.", "rate_notice": "실시간 공시가 비어 있어 교육용 기본값으로 계산하고 있습니다.", "product_details": {}},
        ],
        "전세자금대출": [
            {"id": "fallback-rent-1", "bank_name": "우리은행", "name": "우리전세론", "category": "전세자금대출", "annual_rate": 3.6, "term_months": 180, "description": "전세자금대출은 보증금의 일부를 자기자금으로 내고 나머지를 대출로 맞추는 구조예요.", "rate_notice": "실시간 공시가 비어 있어 교육용 기본값으로 계산하고 있습니다.", "product_details": {}},
            {"id": "fallback-rent-2", "bank_name": "국민은행", "name": "KB 전세자금대출", "category": "전세자금대출", "annual_rate": 3.9, "term_months": 240, "description": "전세금과 대출금의 비중을 함께 보면 월 부담을 더 쉽게 이해할 수 있어요.", "rate_notice": "실시간 공시가 비어 있어 교육용 기본값으로 계산하고 있습니다.", "product_details": {}},
        ],
        "개인신용대출": [
            {"id": "fallback-credit-1", "bank_name": "우리은행", "name": "우리신용대출", "category": "개인신용대출", "annual_rate": 5.4, "term_months": 60, "description": "개인신용대출은 월 소득과 기존 부채를 함께 보며 상환 부담을 점검해야 해요.", "rate_notice": "실시간 공시가 비어 있어 교육용 기본값으로 계산하고 있습니다.", "product_details": {}},
            {"id": "fallback-credit-2", "bank_name": "신한은행", "name": "신한 신용대출", "category": "개인신용대출", "annual_rate": 5.8, "term_months": 84, "description": "월 상환액이 생활비를 지나치게 압박하지 않는지 먼저 살펴보면 좋아요.", "rate_notice": "실시간 공시가 비어 있어 교육용 기본값으로 계산하고 있습니다.", "product_details": {}},
        ],
    }
    for category, endpoint, group_code in sources:
        category_products: list[dict] = []
        try:
            category_products = normalize_products(request_finlife(endpoint, group_code), category)
        except Exception as exc:
            errors.append(f"{category}: {exc}")
        if category_products:
            products.extend(category_products)
        elif category in fallback_products:
            products.extend(fallback_products[category])
    if not products:
        raise HTTPException(status_code=502, detail="금융상품 데이터를 불러오지 못했습니다: " + " / ".join(errors))
    categories = {category: sum(product["category"] == category for product in products) for category, _, _ in sources}
    return {"products": products, "total": len(products), "categories": categories, "partial_errors": errors, "source": "금융감독원 금융상품한눈에", "fetched_at": datetime.now(timezone.utc).isoformat()}
@app.get("/api/scenarios")
def list_scenarios(authorization: str | None = Header(default=None)):
    user_id = current_user_id(authorization)
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM scenarios WHERE user_id = ? ORDER BY id DESC LIMIT 20", (user_id,)).fetchall()
    return [dict(row) for row in rows]
@app.post("/api/scenarios", status_code=201)
def create_scenario(item: ScenarioInput, authorization: str | None = Header(default=None)):
    user_id = current_user_id(authorization)
    with get_db() as conn:
        cursor = conn.execute("""INSERT INTO scenarios (assets, product_id, product_name, bank_name, product_category, annual_rate, years, user_id, job, income_level, credit_score, debt, monthly_expenses, savings_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", (item.assets, item.product_id, item.product_name, item.bank_name, item.product_category, item.annual_rate, item.years, user_id, item.job, item.income_level, item.credit_score, item.debt, item.monthly_expenses, item.savings_level))
        row = conn.execute("SELECT * FROM scenarios WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return dict(row)
