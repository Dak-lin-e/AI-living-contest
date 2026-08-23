import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from './lib/api'
type Product = { id: string; bank_name: string; name: string; category: string; annual_rate: number | null; term_months: number | null; description: string; rate_notice: string; product_details?: Record<string, unknown> }
 type AiImageResponse = { image?: string; is_data_url?: boolean; detail?: string; summary?: string; productType?: string; keyMetrics?: Array<{ label: string; value: number; unit?: string }>; visualizations?: Array<{ type: string; title: string; description: string; data: Array<{ label: string; value: number }> }>; explanation?: string[]; cautions?: string[]; simple_terms?: Array<{ term: string; meaning: string }> }
type ProductResponse = { products?: Product[]; total?: number; source?: string; categories?: Record<string, number>; partial_errors?: string[]; detail?: string }
type Scenario = { id: number; assets: number; product_name: string; bank_name: string; annual_rate: number; years: number; created_at: string }
type ComicTerm = { term: string; meaning: string }
type ComicPanel = { label: string; title: string; text?: string; headline?: string; detail?: string; explanation?: string; term?: string; basis?: string; image_reason?: string; glossary?: ComicTerm[] }
type AiFinancialSummary = NonNullable<AiImageResponse['summary']> extends never ? never : {
  summary?: string;
  productType?: string;
  keyMetrics?: Array<{ label: string; value: number; unit?: string }>;
  visualizations?: Array<{ type: string; title: string; description: string; data: Array<{ label: string; value: number }> }>;
  explanation?: string[];
  cautions?: string[];
  simple_terms?: Array<{ term: string; meaning: string }>;
}
type AiImage = { image: string; is_data_url?: boolean }
const inferMetricUnit = (label: string): string => {
  const normalized = label.replace(/\s+/g, '')
  if (/율|금리|이자율|수익률|비율/.test(normalized)) return '%'
  if (/개월/.test(normalized)) return '개월'
  if (/기간|년/.test(normalized)) return '년'
  return '원'
}
type CalcInputs = { principal: number; rate: number; years: number }
type FormulaStep = { label: string; formula: string; substituted: string; result: string }
type FormulaGuide = {
  terms: Array<{ symbol: string; meaning: string }>
  compute: (inputs: CalcInputs) => FormulaStep[]
  note?: string
}
const formatRate = (rate: number) => `${Number(rate.toFixed(2))}%`
const LOAN_FORMULA: FormulaGuide = {
  terms: [
    { symbol: '대출 원금', meaning: '은행에서 빌린 돈의 총액이에요.' },
    { symbol: '연 금리', meaning: '1년 동안 대출금에 붙는 이자의 비율이에요.' },
    { symbol: '대출 기간(년)', meaning: '대출을 갚아 나가는 전체 기간이에요.' },
  ],
  compute: ({ principal, rate, years }) => {
    const monthlyBurden = principal * (rate / 100) / 12
    const totalInterest = principal * (rate / 100) * years
    const totalRepayment = principal + totalInterest
    const periodLabel = monthLabel(Math.round(years * 12))
    return [
      { label: '월 이자 부담', formula: '대출 원금 × 연 금리 ÷ 12', substituted: `${money(principal)}원 × ${formatRate(rate)} ÷ 12`, result: `${money(monthlyBurden)}원` },
      { label: '총 이자', formula: '대출 원금 × 연 금리 × 대출 기간(년)', substituted: `${money(principal)}원 × ${formatRate(rate)} × ${periodLabel}`, result: `${money(totalInterest)}원` },
      { label: '총 상환액', formula: '대출 원금 + 총 이자', substituted: `${money(principal)}원 + ${money(totalInterest)}원`, result: `${money(totalRepayment)}원` },
    ]
  },
  note: '원금은 그대로 두고 이자만 낸다고 가정한 단순 계산이에요. 실제 원리금균등상환 등 상환 방식에 따라 금액은 달라질 수 있어요.',
}
const DEPOSIT_FORMULA: FormulaGuide = {
  terms: [
    { symbol: '예치 원금', meaning: '처음 은행에 맡기는 돈이에요.' },
    { symbol: '연 금리', meaning: '1년 동안 붙는 이자의 비율이에요.' },
    { symbol: '예치 기간(년)', meaning: '돈을 맡겨 두는 전체 기간이에요.' },
  ],
  compute: ({ principal, rate, years }) => {
    const finalValue = principal * Math.pow(1 + rate / 100, years)
    const preTaxInterest = Math.max(finalValue - principal, 0)
    const afterTaxAmount = principal + preTaxInterest * 0.85
    const exponentLabel = `${Number(years.toFixed(2))} (${monthLabel(Math.round(years * 12))})`
    return [
      { label: '만기 예상 수령액', formula: '예치 원금 × (1 + 연 금리)^예치 기간(년)', substituted: `${money(principal)}원 × (1 + ${formatRate(rate)})^${exponentLabel}`, result: `${money(finalValue)}원` },
      { label: '세전 이자', formula: '만기 예상 수령액 − 예치 원금', substituted: `${money(finalValue)}원 − ${money(principal)}원`, result: `${money(preTaxInterest)}원` },
      { label: '세후 예상 수령액', formula: '예치 원금 + (세전 이자 × 85%, 이자소득세 15% 가정)', substituted: `${money(principal)}원 + (${money(preTaxInterest)}원 × 85%)`, result: `${money(afterTaxAmount)}원` },
    ]
  },
}
const SAVINGS_FORMULA: FormulaGuide = {
  terms: [
    { symbol: '원금', meaning: '내가 넣은 돈이에요.' },
    { symbol: '연 금리', meaning: '1년 동안 붙는 이자의 비율이에요.' },
    { symbol: '유지 기간(년)', meaning: '적금을 넣어 두는 전체 기간이에요.' },
  ],
  compute: ({ principal, rate, years }) => {
    const finalValue = principal * Math.pow(1 + rate / 100, years)
    const interest = Math.max(finalValue - principal, 0)
    const exponentLabel = `${Number(years.toFixed(2))} (${monthLabel(Math.round(years * 12))})`
    return [
      { label: '만기 예상 수령액', formula: '원금 × (1 + 연 금리)^유지 기간(년)', substituted: `${money(principal)}원 × (1 + ${formatRate(rate)})^${exponentLabel}`, result: `${money(finalValue)}원` },
      { label: '예상 이자', formula: '만기 예상 수령액 − 원금', substituted: `${money(finalValue)}원 − ${money(principal)}원`, result: `${money(interest)}원` },
    ]
  },
  note: '실제 적금은 매달 나누어 납입하지만, 여기서는 목돈을 한 번에 넣는 예금 방식으로 단순화해 계산했어요.',
}
const resolveFormulaGuide = (productType?: string): FormulaGuide | undefined => {
  if (!productType) return undefined
  const normalized = productType.replace(/\s+/g, '')
  if (/적금/.test(normalized)) return SAVINGS_FORMULA
  if (/예금/.test(normalized)) return DEPOSIT_FORMULA
  if (/주택담보|전세|신용대출|대출/.test(normalized)) return LOAN_FORMULA
  return undefined
}
const normalizeAiSummary = (input: Record<string, unknown> | null | undefined): AiFinancialSummary => {
  const safeSummary = typeof input?.summary === 'string' ? input.summary : undefined
  const safeProductType = typeof input?.productType === 'string' ? input.productType : undefined
  const timeOrderScore = (label: string) => {
    const normalized = label.replace(/\s+/g, '')
    if (/현재|시작|지금/.test(normalized)) return 0
    const yearMatch = normalized.match(/(\d+)년/)
    if (yearMatch) return Number(yearMatch[1])
    if (/만기|최종|결말/.test(normalized)) return 999
    return 100
  }
  const normalizeMetrics = (value: unknown): Array<{ label: string; value: number; unit?: string }> => {
    const asArray: Array<{ label: string; value: number; unit?: string }> = []
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((metric, index) => {
        if (typeof metric === 'object' && metric && 'label' in metric && 'value' in metric) {
          const candidate = metric as Record<string, unknown>
          const label = String(candidate.label ?? `지표 ${index + 1}`)
          asArray.push({
            label,
            value: Number(candidate.value ?? 0),
            unit: typeof candidate.unit === 'string' && candidate.unit ? candidate.unit : inferMetricUnit(label),
          })
        } else {
          asArray.push({ label: `지표 ${index + 1}`, value: Number(metric ?? 0), unit: '원' })
        }
      })
      return asArray.sort((a, b) => timeOrderScore(a.label) - timeOrderScore(b.label))
    }
    if (value && typeof value === 'object') {
      Object.entries(value as Record<string, unknown>).forEach(([label, metricValue]) => {
        asArray.push({ label, value: Number(metricValue ?? 0), unit: inferMetricUnit(label) })
      })
      return asArray.sort((a, b) => timeOrderScore(a.label) - timeOrderScore(b.label))
    }
    return []
  }
  const makeFallbackVisualizations = (metrics: Array<{ label: string; value: number; unit?: string }>): Array<{ type: string; title: string; description: string; data: Array<{ label: string; value: number }> }> => {
    const validMetrics = metrics.filter(metric => Number.isFinite(metric.value))
    if (validMetrics.length >= 2) {
      return [{
        type: 'line_chart',
        title: '시간 흐름',
        description: '시간이 흐를수록 자산이 어떻게 변하는지 순서대로 보여줘요.',
        data: validMetrics
          .sort((a, b) => timeOrderScore(a.label) - timeOrderScore(b.label))
          .map(metric => ({ label: metric.label, value: Number(metric.value) || 0 })),
      }]
    }
    return []
  }
  const normalizeVisualizations = (value: unknown, metrics: Array<{ label: string; value: number; unit?: string }> = []): Array<{ type: string; title: string; description: string; data: Array<{ label: string; value: number }> }> => {
    const fallback = makeFallbackVisualizations(metrics)
    if (Array.isArray(value)) {
      const charts = value.filter(Boolean).map((chart, index) => {
        if (typeof chart === 'object' && chart) {
          const candidate = chart as Record<string, unknown>
          const data = Array.isArray(candidate.data)
            ? candidate.data.map((row, rowIndex) => {
                if (typeof row === 'object' && row && 'label' in row && 'value' in row) {
                  const item = row as Record<string, unknown>
                  return { label: String(item.label ?? `항목 ${rowIndex + 1}`), value: Number(item.value ?? 0) }
                }
                return { label: `항목 ${rowIndex + 1}`, value: 0 }
              })
            : []
          return {
            type: typeof candidate.type === 'string' ? candidate.type : 'line_chart',
            title: typeof candidate.title === 'string' ? candidate.title : `차트 ${index + 1}`,
            description: typeof candidate.description === 'string' ? candidate.description : '',
            data,
          }
        }
        return { type: 'bar_chart', title: `차트 ${index + 1}`, description: '', data: [] }
      }).filter(chart => chart.data.length > 0)
      return charts.length ? charts : fallback
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
      const charts = entries.map(([title, chartValue]) => {
        if (typeof chartValue === 'string') return { type: 'bar_chart', title, description: chartValue, data: [] }
        const candidate = chartValue as Record<string, unknown>
        const data = candidate.data && Array.isArray(candidate.data)
          ? candidate.data.map((row, rowIndex) => {
              if (typeof row === 'object' && row && 'label' in row && 'value' in row) {
                const item = row as Record<string, unknown>
                return { label: String(item.label ?? `항목 ${rowIndex + 1}`), value: Number(item.value ?? 0) }
              }
              return { label: `항목 ${rowIndex + 1}`, value: 0 }
            })
          : Object.entries(candidate).filter(([key]) => !['type', 'title', 'description'].includes(key)).map(([label, numericValue]) => ({ label, value: Number(numericValue ?? 0) }))
        return {
          type: typeof candidate.type === 'string' ? candidate.type : 'line_chart',
          title: typeof candidate.title === 'string' ? candidate.title : title,
          description: typeof candidate.description === 'string' ? candidate.description : '',
          data,
        }
      }).filter(chart => chart.data.length > 0)
      return charts.length ? charts : fallback
    }
    return fallback
  }
  const orderedMetrics = normalizeMetrics(input?.keyMetrics)
  const explanation = Array.isArray(input?.explanation) ? input.explanation.filter((entry): entry is string => typeof entry === 'string') : typeof input?.explanation === 'string' ? [input.explanation] : []
  const cautions = Array.isArray(input?.cautions) ? input.cautions.filter((entry): entry is string => typeof entry === 'string') : typeof input?.cautions === 'string' ? [input.cautions] : []
  const simpleTerms = Array.isArray(input?.simple_terms)
    ? input.simple_terms.filter((entry): entry is { term: string; meaning: string } => typeof entry === 'object' && entry !== null && 'term' in entry && 'meaning' in entry).map(entry => ({ term: String((entry as Record<string, unknown>).term ?? ''), meaning: String((entry as Record<string, unknown>).meaning ?? '') })).filter(entry => entry.term && entry.meaning)
    : []
  return {
    summary: safeSummary,
    productType: safeProductType,
    keyMetrics: orderedMetrics,
    visualizations: normalizeVisualizations(input?.visualizations, orderedMetrics),
    explanation,
    cautions,
    simple_terms: simpleTerms,
  }
}
const money = (n: number) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(n)
const percent = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
const formatMetricValue = (value: number, unit?: string) =>
  unit === '%' ? new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value) : money(value)
const LOAN_FALLBACK_RATES: Record<string, number> = { '주택담보대출': 3.8, '전세자금대출': 3.6, '개인신용대출': 5.4 }
const QUARTER_INTERVAL_CANDIDATES = [3, 6, 12, 24, 36, 60, 120]
const monthLabel = (month: number): string => {
  if (month <= 0) return '시작'
  const y = Math.floor(month / 12)
  const rem = month % 12
  if (rem === 0) return `${y}년`
  if (y === 0) return `${rem}개월`
  return `${y}년 ${rem}개월`
}
const quarterlyMonths = (totalMonths: number, maxPoints = 13): number[] => {
  const total = Math.max(1, Math.round(totalMonths))
  let interval = QUARTER_INTERVAL_CANDIDATES[QUARTER_INTERVAL_CANDIDATES.length - 1]
  for (const candidate of QUARTER_INTERVAL_CANDIDATES) {
    if (Math.floor(total / candidate) + 1 <= maxPoints) { interval = candidate; break }
  }
  const steps: number[] = []
  for (let m = 0; m < total; m += interval) steps.push(m)
  if (steps[steps.length - 1] !== total) steps.push(total)
  return steps
}
function Icon({ type }: { type: 'wallet' | 'shield' | 'chart' | 'star' }) { return <span className={`icon icon-${type}`} aria-hidden="true">{type === 'wallet' ? '₩' : type === 'shield' ? '✓' : type === 'chart' ? '↗' : '★'}</span> }
const renderVisualization = (chart: { type: string; title: string; description: string; data: Array<{ label: string; value: number }> }) => {
  const values = chart.data.map(item => Number(item.value) || 0)
  const maxValue = Math.max(...values, 1)
  const total = values.reduce((sum, value) => sum + value, 0)

  if (chart.type === 'line_chart' || chart.type === 'timeline') {
    const lineMin = Math.min(...values)
    const lineMax = Math.max(...values)
    const lineRange = lineMax - lineMin || 1
    const coords = chart.data.map((item, index) => {
      const x = chart.data.length === 1 ? 50 : (index / (chart.data.length - 1)) * 100
      const y = 85 - ((Number(item.value) || 0) - lineMin) / lineRange * 70
      return { x, y, value: Number(item.value) || 0 }
    })
    const points = coords.map(point => `${point.x},${point.y}`).join(' ')
    const areaPath = `M ${coords[0]?.x ?? 0},100 L ${points.replace(/ /g, ' L ')} L ${coords[coords.length - 1]?.x ?? 100},100 Z`

    return <div className="data-visualization"><div className="viz-header"><strong>{chart.title}</strong><span>{chart.description}</span></div><div className="line-chart-values">{coords.map((point, index) => <span key={`${chart.title}-value-${index}`}>{money(point.value)}원</span>)}</div><div className="line-chart-plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="line-chart" aria-label={chart.title}><path d={areaPath} className="line-chart-area" /><polyline points={points} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg><div className="line-chart-dots">{coords.map((point, index) => <span key={`${chart.title}-${index}`} className="line-chart-dot" style={{ left: `${point.x}%`, top: `${point.y}%` }} />)}</div></div><div className="viz-labels">{chart.data.map((item, index) => <span key={`${chart.title}-${item.label}-${index}`}>{item.label}</span>)}</div></div>
  }

  if (chart.type === 'donut_chart') {
    const segments = chart.data.map((item, index) => {
      const percentValue = total === 0 ? 0 : ((Number(item.value) || 0) / total) * 100
      const previousTotal = chart.data.slice(0, index).reduce((sum, entry) => sum + (Number(entry.value) || 0), 0)
      const start = total === 0 ? 0 : (previousTotal / total) * 100
      const end = total === 0 ? 0 : ((previousTotal + (Number(item.value) || 0)) / total) * 100
      return `${item.label} ${start}% ${end}%`
    })
    const ringStyle = {
      background: total === 0
        ? 'conic-gradient(#dfe8f5 0 100%)'
        : `conic-gradient(${['#3182f6', '#7db5ff', '#a9d1ff', '#dfe8f5'][0]} 0 ${segments[0]?.includes(' ') ? '100%' : '100%'})`,
    }
    return <div className="data-visualization"><div className="viz-header"><strong>{chart.title}</strong><span>{chart.description}</span></div><div className="donut-wrap"><div className="donut-chart" style={ringStyle}><div className="donut-center"><span>{money(total)}</span><small>총액</small></div></div><div className="viz-list">{chart.data.map((item, index) => <div key={`${chart.title}-${item.label}-${index}`} className="viz-row"><span>{item.label}</span><b>{money(Number(item.value) || 0)}</b></div>)}</div></div></div>
  }

  if (chart.type === 'comparison_table' || chart.type === 'repayment_chart' || chart.type === 'bar_chart') {
    return <div className="data-visualization"><div className="viz-header"><strong>{chart.title}</strong><span>{chart.description}</span></div><div className="bar-chart">{chart.data.map((item, index) => <div key={`${chart.title}-${item.label}-${index}`} className="bar-stack"><div className="bar-label"><span>{item.label}</span><strong>{money(Number(item.value) || 0)}원</strong></div><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max((Number(item.value) || 0) / maxValue * 100, 10)}%` }} /></div></div>)}</div></div>
  }

  return <div className="data-visualization"><div className="viz-header"><strong>{chart.title}</strong><span>{chart.description}</span></div><div className="viz-list">{chart.data.map((item, index) => <div key={`${chart.title}-${item.label}-${index}`} className="viz-row"><span>{item.label}</span><b>{money(Number(item.value) || 0)}원</b></div>)}</div></div>
}
export default function App() {
  const [assets, setAssets] = useState('10000000')
  const [job, setJob] = useState('')
  const [incomeLevel, setIncomeLevel] = useState('')
  const [creditScore, setCreditScore] = useState('')
  const [monthlyExpenses, setMonthlyExpenses] = useState('0')
  const [savingsLevel, setSavingsLevel] = useState('')
  const [housePrice, setHousePrice] = useState('')
  const [mortgageDownPayment, setMortgageDownPayment] = useState('')
  const [mortgageLoanAmount, setMortgageLoanAmount] = useState('')
  const [mortgageMonthlyIncome, setMortgageMonthlyIncome] = useState('')
  const [mortgageMonthlyExpenses, setMortgageMonthlyExpenses] = useState('')
  const [mortgageExistingDebt, setMortgageExistingDebt] = useState('')
  const [rentDeposit, setRentDeposit] = useState('')
  const [rentDownPayment, setRentDownPayment] = useState('')
  const [rentLoanAmount, setRentLoanAmount] = useState('')
  const [rentMonthlyIncome, setRentMonthlyIncome] = useState('')
  const [rentMonthlyExpenses, setRentMonthlyExpenses] = useState('')
  const [creditLoanAmount, setCreditLoanAmount] = useState('')
  const [creditMonthlyIncome, setCreditMonthlyIncome] = useState('')
  const [creditMonthlyExpenses, setCreditMonthlyExpenses] = useState('')
  const [creditExistingDebt, setCreditExistingDebt] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [bank, setBank] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [months, setMonths] = useState('12')
  const [category, setCategory] = useState('전체')
  const [active, setActive] = useState(0)
  const [saved, setSaved] = useState<Scenario[]>([])
  const [loading, setLoading] = useState(false)
  const [productsLoading, setProductsLoading] = useState(true)
  const [error, setError] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [catalogTotal, setCatalogTotal] = useState(0)
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})
  const [partialNotice, setPartialNotice] = useState('')
  const [source, setSource] = useState('금융감독원 금융상품한눈에')
  const [aiPanels, setAiPanels] = useState<ComicPanel[] | null>(null)
  const [aiImage, setAiImage] = useState<AiImage | null>(null)
  const [aiSummary, setAiSummary] = useState<AiFinancialSummary | null>(null)
  const [calcInputs, setCalcInputs] = useState<{ principal: number; rate: number; years: number } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const filteredProducts = products.filter(product => (category === '전체' || product.category === category) && (!bank || product.bank_name === bank))
  const banks = [...new Set(products.filter(product => category === '전체' || product.category === category).map(product => product.bank_name))].sort()
  const selectedProduct = products.find(product => product.id === selectedId) || filteredProducts[0]
  const selectedCategory = selectedProduct?.category || category
  const isMortgageLoanCategory = selectedCategory === '주택담보대출'
  const isRentLoanCategory = selectedCategory === '전세자금대출'
  const isCreditLoanCategory = selectedCategory === '개인신용대출'
  const isLoanCategory = isMortgageLoanCategory || isRentLoanCategory || isCreditLoanCategory
  const loanPrincipal = isMortgageLoanCategory ? Number(mortgageLoanAmount) || 0 : isRentLoanCategory ? Number(rentLoanAmount) || 0 : isCreditLoanCategory ? Number(creditLoanAmount) || 0 : 0
  const principal = isLoanCategory ? loanPrincipal : Number(assets) || 0
  const annual = selectedProduct?.annual_rate || 0
  const effectiveAnnual = selectedProduct?.annual_rate ?? (isLoanCategory ? LOAN_FALLBACK_RATES[selectedCategory] ?? 0 : 0)
  const durationMonths = Number(months) || 1
  const duration = durationMonths / 12
  const totalInterest = isLoanCategory ? principal * (effectiveAnnual / 100) * duration : 0
  const finalValue = isLoanCategory ? principal + totalInterest : principal * Math.pow(1 + effectiveAnnual / 100, duration)
  const gain = isLoanCategory ? totalInterest : finalValue - principal
  const totalReturn = principal ? (gain / principal) * 100 : 0
  const totalMonths = durationMonths
  const monthSteps = useMemo(() => quarterlyMonths(totalMonths), [totalMonths])
  const points = useMemo(
    () => monthSteps.map(m => isLoanCategory ? principal + totalInterest * (m / totalMonths) : principal * Math.pow(1 + effectiveAnnual / 100, m / 12)),
    [monthSteps, principal, effectiveAnnual, isLoanCategory, totalInterest, totalMonths]
  )
  const maxPoint = Math.max(...points, 1)
  useEffect(() => {
    const load = async () => {
      try {
        const [productResponse, scenarioResponse] = await Promise.all([api('products'), api('scenarios')])
        const data = await productResponse.json() as ProductResponse
        if (!productResponse.ok) throw new Error(data.detail || '상품 정보를 불러오지 못했습니다.')
        const catalog = data.products || []
        setProducts(catalog); setCatalogTotal(data.total ?? catalog.length); setCategoryCounts(data.categories || {}); setPartialNotice(data.partial_errors?.length ? `일부 조회 상태: ${data.partial_errors.join(' · ')}` : ''); setSource(data.source || '금융감독원 금융상품한눈에')
        setSelectedId(catalog[0]?.id || ''); setBank(catalog[0]?.bank_name || '')
        if (scenarioResponse.ok) setSaved(await scenarioResponse.json() as Scenario[])
      } catch (err) { setCatalogError(err instanceof Error ? `실제 금융상품 정보를 불러오지 못했어요. ${err.message}` : '상품 정보를 불러오지 못했어요.') } finally { setProductsLoading(false) }
    }
    load()
  }, [])
  useEffect(() => {
    if (selectedProduct?.term_months && selectedProduct.term_months > 0) {
      setMonths(String(Math.round(selectedProduct.term_months)))
    }
  }, [selectedProduct?.id])
  const chooseCategory = (next: string) => { setCategory(next); setBank(''); const nextProduct = products.find(product => next === '전체' || product.category === next); if (nextProduct) setSelectedId(nextProduct.id) }
  const renderProductSpecificFields = () => {
    if (selectedCategory === '주택담보대출') {
      return <>
        <label>주택가격<div className="input-wrap"><input value={housePrice} onChange={e => setHousePrice(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
        <label>자기자금<div className="input-wrap"><input value={mortgageDownPayment} onChange={e => setMortgageDownPayment(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
        <label>희망 대출금액<div className="input-wrap"><input value={mortgageLoanAmount} onChange={e => setMortgageLoanAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
        <label>월 소득<div className="input-wrap"><input value={mortgageMonthlyIncome} onChange={e => setMortgageMonthlyIncome(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
        <label>월 지출<div className="input-wrap"><input value={mortgageMonthlyExpenses} onChange={e => setMortgageMonthlyExpenses(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
        <label>기존 대출<div className="input-wrap"><input value={mortgageExistingDebt} onChange={e => setMortgageExistingDebt(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
      </>
    }
    if (selectedCategory === '전세자금대출') {
      return <>
        <label>전세보증금<div className="input-wrap"><input value={rentDeposit} onChange={e => setRentDeposit(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
        <label>자기자금<div className="input-wrap"><input value={rentDownPayment} onChange={e => setRentDownPayment(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
        <label>희망 대출금액<div className="input-wrap"><input value={rentLoanAmount} onChange={e => setRentLoanAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
        <label>월 소득<div className="input-wrap"><input value={rentMonthlyIncome} onChange={e => setRentMonthlyIncome(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
        <label>월 지출<div className="input-wrap"><input value={rentMonthlyExpenses} onChange={e => setRentMonthlyExpenses(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
      </>
    }
    if (selectedCategory === '개인신용대출') {
      return <>
        <label>희망 대출금액<div className="input-wrap"><input value={creditLoanAmount} onChange={e => setCreditLoanAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
        <label>월 소득<div className="input-wrap"><input value={creditMonthlyIncome} onChange={e => setCreditMonthlyIncome(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
        <label>월 지출<div className="input-wrap"><input value={creditMonthlyExpenses} onChange={e => setCreditMonthlyExpenses(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
        <label>기존 대출<div className="input-wrap"><input value={creditExistingDebt} onChange={e => setCreditExistingDebt(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
      </>
    }
    return <>
      <label>현재 보유 자산<div className="input-wrap"><input value={assets} onChange={e => setAssets(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>원</span></div></label>
      <label>직업<input value={job} onChange={e => setJob(e.target.value)} placeholder="예: 회사원" /></label>
      <label>소득 수준<input value={incomeLevel} onChange={e => setIncomeLevel(e.target.value)} placeholder="예: 월 300~500만원" /></label>
      <label>신용점수<input value={creditScore} onChange={e => setCreditScore(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="예: 850" /></label>
      <label>저축 수준<div className="input-wrap"><input value={savingsLevel} onChange={e => setSavingsLevel(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="예: 20" /><span>만원/월</span></div></label>
      <label>월 고정 지출<div className="input-wrap"><input value={monthlyExpenses} onChange={e => setMonthlyExpenses(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="예: 200" /><span>만원</span></div></label>
    </>
  }
  const generate = async (e?: FormEvent) => {
    if (e) e.preventDefault(); setError('')
    const isSavingsProduct = selectedCategory === '정기예금' || selectedCategory === '적금'
    const isMortgageLoan = selectedCategory === '주택담보대출'
    const isRentLoan = selectedCategory === '전세자금대출'
    const isCreditLoan = selectedCategory === '개인신용대출'
    const productAllowsFallbackRate = isMortgageLoan || isRentLoan || isCreditLoan
    if (!selectedProduct) return setError('은행과 금융상품을 선택해 주세요.')
    if (selectedProduct.annual_rate === null && !productAllowsFallbackRate) return setError('선택 상품의 공시 금리를 확인할 수 없어요.')
    if (durationMonths < 1 || durationMonths > 360) return setError('예상 유지 기간은 1~360개월 사이로 입력해 주세요.')
    if (isSavingsProduct) {
      if (principal <= 0) return setError('현재 자산은 1원 이상 입력해 주세요.')
      if (!job || !incomeLevel || !creditScore || !savingsLevel) return setError('직업, 소득 수준, 신용점수, 저축 수준을 모두 입력해 주세요.')
    }
    if (isMortgageLoan && (!housePrice || !mortgageDownPayment || !mortgageLoanAmount || !mortgageMonthlyIncome || !mortgageMonthlyExpenses)) {
      return setError('주택가격, 자기자금, 희망 대출금액, 월 소득, 월 지출을 모두 입력해 주세요.')
    }
    if (isRentLoan && (!rentDeposit || !rentDownPayment || !rentLoanAmount || !rentMonthlyIncome || !rentMonthlyExpenses)) {
      return setError('전세보증금, 자기자금, 희망 대출금액, 월 소득, 월 지출을 모두 입력해 주세요.')
    }
    if (isCreditLoan && (!creditLoanAmount || !creditMonthlyIncome || !creditMonthlyExpenses)) {
      return setError('희망 대출금액, 월 소득, 월 지출을 모두 입력해 주세요.')
    }
    setLoading(true); setAiLoading(true); setActive(0); setAiError(''); setAiPanels(null); setAiImage(null); setAiSummary(null)
    try {
      const requestedAnnualRate = Number(selectedProduct?.annual_rate ?? (LOAN_FALLBACK_RATES[selectedProduct.category] ?? 0))
      const requestAssets = isMortgageLoan ? Number(housePrice) || 0 : isRentLoan ? Number(rentDeposit) || 0 : isCreditLoan ? Number(creditLoanAmount) || 0 : principal
      const formulaPrincipal = isMortgageLoan ? Number(mortgageLoanAmount) || 0 : isRentLoan ? Number(rentLoanAmount) || 0 : isCreditLoan ? Number(creditLoanAmount) || 0 : principal
      setCalcInputs({ principal: formulaPrincipal, rate: requestedAnnualRate, years: duration })
      const requestDebt = isMortgageLoan ? Number(mortgageExistingDebt) || 0 : isCreditLoan ? Number(creditExistingDebt) || 0 : 0
      const requestMonthlyExpenses = isMortgageLoan ? Number(mortgageMonthlyExpenses) || 0 : isRentLoan ? Number(rentMonthlyExpenses) || 0 : isCreditLoan ? Number(creditMonthlyExpenses) || 0 : Number(monthlyExpenses) || 0
      const requestSavingsLevel = isSavingsProduct ? (savingsLevel ? `${savingsLevel}만원/월` : '') : '0만원/월'
      const requestIncomeLevel = isSavingsProduct ? incomeLevel : (isMortgageLoan ? `${money(Number(mortgageMonthlyIncome) || 0)}원/월` : isRentLoan ? `${money(Number(rentMonthlyIncome) || 0)}원/월` : `${money(Number(creditMonthlyIncome) || 0)}원/월`)
      const requestCreditScore = Number(creditScore || 0)
      const productDetails = {
        ...(selectedProduct.product_details || {}),
        ...(isMortgageLoan ? {
          house_price: Number(housePrice) || 0,
          mortgage_down_payment: Number(mortgageDownPayment) || 0,
          mortgage_loan_amount: Number(mortgageLoanAmount) || 0,
          mortgage_monthly_income: Number(mortgageMonthlyIncome) || 0,
          mortgage_monthly_expenses: Number(mortgageMonthlyExpenses) || 0,
          mortgage_existing_debt: Number(mortgageExistingDebt) || 0,
        } : {}),
        ...(isRentLoan ? {
          rent_deposit: Number(rentDeposit) || 0,
          rent_down_payment: Number(rentDownPayment) || 0,
          rent_loan_amount: Number(rentLoanAmount) || 0,
          rent_monthly_income: Number(rentMonthlyIncome) || 0,
          rent_monthly_expenses: Number(rentMonthlyExpenses) || 0,
        } : {}),
        ...(isCreditLoan ? {
          credit_loan_amount: Number(creditLoanAmount) || 0,
          credit_monthly_income: Number(creditMonthlyIncome) || 0,
          credit_monthly_expenses: Number(creditMonthlyExpenses) || 0,
          credit_existing_debt: Number(creditExistingDebt) || 0,
        } : {}),
      }
      const input = {
        assets: requestAssets,
        product_id: selectedProduct.id,
        product_name: selectedProduct.name,
        bank_name: selectedProduct.bank_name,
        product_category: selectedProduct.category,
        annual_rate: requestedAnnualRate,
        years: duration,
        product_term_months: selectedProduct.term_months || 0,
        job: job || '대출 고객',
        income_level: requestIncomeLevel,
        credit_score: requestCreditScore,
        debt: requestDebt,
        monthly_expenses: requestMonthlyExpenses * 10000,
        savings_level: requestSavingsLevel,
        product_details: productDetails,
        house_price: Number(housePrice) || 0,
        mortgage_down_payment: Number(mortgageDownPayment) || 0,
        mortgage_loan_amount: Number(mortgageLoanAmount) || 0,
        mortgage_monthly_income: Number(mortgageMonthlyIncome) || 0,
        mortgage_monthly_expenses: Number(mortgageMonthlyExpenses) || 0,
        mortgage_existing_debt: Number(mortgageExistingDebt) || 0,
        rent_deposit: Number(rentDeposit) || 0,
        rent_down_payment: Number(rentDownPayment) || 0,
        rent_loan_amount: Number(rentLoanAmount) || 0,
        rent_monthly_income: Number(rentMonthlyIncome) || 0,
        rent_monthly_expenses: Number(rentMonthlyExpenses) || 0,
        credit_loan_amount: Number(creditLoanAmount) || 0,
        credit_monthly_income: Number(creditMonthlyIncome) || 0,
        credit_monthly_expenses: Number(creditMonthlyExpenses) || 0,
        credit_existing_debt: Number(creditExistingDebt) || 0,
      }
      const [scenarioRes, comicRes] = await Promise.all([
        api('scenarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
        api('ai/comic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
      ])
      if (!scenarioRes.ok) throw new Error('기록 저장')
      const item = await scenarioRes.json() as Scenario
      setSaved(prev => [item, ...prev].slice(0, 20))
      if (comicRes.ok) {
        const data = await comicRes.json() as AiImageResponse & { panels?: ComicPanel[] }
        if (data && typeof data === 'object' && (('summary' in data) || ('productType' in data) || ('keyMetrics' in data))) {
          setAiSummary(normalizeAiSummary(data as Record<string, unknown>))
          setAiImage(null)
          setAiPanels(null)
          return
        }
        if (!data.image) throw new Error('이미지 결과 없음')
        setAiImage({ image: data.image, is_data_url: data.is_data_url })
        if (Array.isArray(data.panels) && data.panels.length) setAiPanels(data.panels); else setAiPanels(null)
      } else {
        const data = await comicRes.json().catch(() => ({})) as AiImageResponse
        setAiError(data.detail || 'AI 자산 흐름 차트를 만들지 못했어요.')
      }
    } catch { setError('기록을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.') } finally { setLoading(false); setAiLoading(false) }
  }
  const panels = [{ label: '01 · 나의 출발점', title: '현재 내 자산과 생활을 살펴봐요', text: `${job} · ${incomeLevel} · 월 고정 지출 ${money(Number(monthlyExpenses) || 0)}원인 나의 출발점을 기록했어요.`, type: 'wallet' as const }, { label: '02 · 실제 공시 상품', title: `${selectedProduct?.name || '금융상품'}을 만났어요`, text: `${selectedProduct?.bank_name || '은행'}의 ${selectedProduct?.category || '금융상품'}이에요. 공시 최고금리 연 ${annual.toFixed(2)}%를 기준으로 살펴봐요.`, type: 'shield' as const }, { label: '03 · 시간이 흐르면', title: '작은 차이가 쌓여요', text: `${monthLabel(totalMonths)} 후 예상 수익은 ${money(gain)}원이에요.`, type: 'chart' as const }, { label: '04 · 이야기의 결말', title: '내 자산의 다음 장면', text: `예상 자산은 ${money(finalValue)}원! 실제 적용 조건도 확인해요.`, type: 'star' as const }]
  const comicPanels = aiPanels && aiPanels.length
    ? aiPanels
    : panels.map((panel, index) => ({
        label: `0${index + 1} · ${panel.label.replace(/^0\d+\s*·\s*/, '')}`,
        title: panel.title,
        text: panel.text,
        explanation: index === 0
          ? '현재 자산과 부채, 고정 지출을 함께 보지 않으면 실제로 남는 여력이 얼마나 되는지 잘 보이지 않습니다.'
          : index === 1
            ? '상품의 금리만 보지 말고 기간, 한도, 우대 조건까지 함께 살펴야 적합성을 판단할 수 있습니다.'
            : index === 2
              ? '시간이 흐르면서 복리로 차이가 커지기 때문에 단기 수익률보다 장기 흐름을 보는 것이 중요합니다.'
              : '마지막 결과는 참고용이며, 실제 계약 전 금리, 비용, 중도상환 규정, 부채 상황을 다시 확인해야 합니다.',
        image_reason: index === 0
          ? '이 컷은 현재 자산, 부채, 고정 지출이 어떤 상태인지 한눈에 보이도록 큰 숫자와 지출/부채 아이콘을 배치해 출발점을 강조합니다.'
          : index === 1
            ? '이 컷은 금리와 상품 조건을 시각적으로 강조해 좋은 상품이 실제로 나에게 맞는지 비교하는 흐름으로 표현합니다.'
            : index === 2
              ? '시간의 흐름을 화살표와 그래프로 보여주며, 복리가 얼마나 커지는지를 시각적으로 설명해 자산이 점점 늘어나는 과정을 드러냅니다.'
              : '마지막 화면은 예상치와 주의사항을 함께 보여줘 “이건 참고값”이라는 점을 강조하고, 계약 전 재확인이 중요하다는 메시지를 전달합니다.',
        glossary: index === 0
          ? [{ term: '자산', meaning: '보유한 돈과 가치 있는 재산의 총합을 뜻해요.' }, { term: '부채', meaning: '갚아야 하는 돈으로, 생활 부담을 키울 수 있어요.' }]
          : index === 1
            ? [{ term: '금리', meaning: '돈을 맡기거나 빌릴 때 붙는 이자 비율을 말해요.' }, { term: '우대조건', meaning: '특정 조건을 충족하면 더 좋은 조건을 받는 항목이에요.' }]
            : index === 2
              ? [{ term: '복리', meaning: '이자에 다시 이자가 붙어 시간이 지날수록 차이가 커지는 방식이에요.' }, { term: '자산흐름', meaning: '돈이 들어오고 나가며 어떻게 쌓이거나 줄어드는지를 뜻해요.' }]
              : [{ term: '참고용', meaning: '현재 조건으로 보는 예상치라서 실제 계약 전에 다시 검토해야 해요.' }, { term: '중도상환', meaning: '계약 기간 중 일부를 미리 갚을 때 발생하는 조건과 비용을 말해요.' }],
      }))
  const imageSrc = aiImage
    ? aiImage.is_data_url || /^data:image\//i.test(aiImage.image)
      ? aiImage.image
      : `data:image/png;base64,${aiImage.image}`
    : ''
  const activePanel = comicPanels[Math.min(active, comicPanels.length - 1)] || comicPanels[0]
  const formulaGuide = resolveFormulaGuide(aiSummary?.productType)
  const formulaSteps = formulaGuide && calcInputs ? formulaGuide.compute(calcInputs) : []
  return <div className="app-shell"><header className="topbar"><div className="brand-mark">돈</div><div><h1>돈길</h1></div></header><main><section className="intro"><div><span className="section-kicker">ASSET FLOW</span><h2>금융상품 계약기간 동안<br /><em>자산이 어떻게 변할지</em> 보여요.</h2><p>{source}의 실제 금융상품을 기준으로, 기간별 자산 변화와 예상 가치를 그래프 중심으로 정리해 드려요.</p></div><div className="book-badge"><span>오늘의</span><strong>자산<br />추이</strong><div className="badge-line" /></div></section><section className="input-card"><div className="card-heading"><div><span className="number-dot">1</span><h3>내 이야기의 재료를 입력해요</h3></div><span className="required">실제 공시 상품 · {catalogTotal}건</span></div>{catalogError ? <p className="form-error">{catalogError}</p> : <><div className="category-tabs" role="group" aria-label="상품 유형 선택">{['전체', '정기예금', '적금', '주택담보대출', '전세자금대출', '개인신용대출'].map(item => <button key={item} type="button" onClick={() => chooseCategory(item)} className={category === item ? 'active' : ''}>{item}{item !== '전체' && ` ${categoryCounts[item] ?? 0}건`}</button>)}</div><form onSubmit={generate} className="form-grid">{renderProductSpecificFields()}<label>예상 유지 기간<div className="input-wrap"><input value={months} onChange={e => setMonths(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /><span>개월</span></div></label><label className="bank-field">은행 선택<select value={bank} onChange={e => { setBank(e.target.value); const p = products.find(item => item.bank_name === e.target.value && (category === '전체' || item.category === category)); if (p) setSelectedId(p.id) }} disabled={productsLoading}><option value="">은행을 선택해 주세요</option>{banks.map(item => <option key={item}>{item}</option>)}</select></label><label className="product-field">상세 금융상품<select value={selectedProduct?.id || ''} onChange={e => setSelectedId(e.target.value)} disabled={productsLoading || !bank}><option value="">{bank ? '상품을 선택해 주세요' : '먼저 은행을 선택해 주세요'}</option>{filteredProducts.map(product => <option key={product.id} value={product.id}>{product.name}{product.annual_rate !== null ? ` · 연 ${product.annual_rate}%` : ' · 교육용 기준값 적용'}</option>)}</select></label><button className="generate" disabled={loading || productsLoading || !selectedProduct || (!selectedProduct.annual_rate && !['주택담보대출', '전세자금대출', '개인신용대출'].includes(selectedCategory))} type="submit">{loading ? '이야기 준비 중…' : '내 4컷 만들기'} <span>→</span></button></form></>}{selectedProduct && <div className="product-detail"><div><b>{selectedProduct.bank_name} · {selectedProduct.name}</b><span>{selectedProduct.category}{selectedProduct.term_months ? ` · ${selectedProduct.term_months}개월 기준` : ''} · 공시 최고금리 연 {annual.toFixed(2)}%</span></div><small>{selectedProduct.description || selectedProduct.rate_notice}</small></div>}{partialNotice && <p className="catalog-warning">{partialNotice}</p>}{error && <p className="form-error">{error}</p>}</section><section className="comic-section"><div className="section-title"><div><span className="section-kicker">MY MONEY STORY</span><h2>나의 자산, 이렇게 흘러가요</h2></div></div><div className="comic-window">{aiLoading ? <div className="comic-loading"><div className="loading-orbit" aria-hidden="true"><div className="loading-core" /><div className="loading-ring ring-a" /><div className="loading-ring ring-b" /></div><div className="loading-copy"><strong>자산 흐름 분석 중</strong><span className="typing-text">AI가 금융 해설을 준비하고 있어요…</span></div></div> : aiError ? <div className="comic-error"><strong>분석을 준비하지 못했어요</strong><p>{aiError}</p><button type="button" className="retry-button" onClick={() => void generate()}>다시 시도</button></div> : aiSummary ? <div className="comic-image-shell"><div className="comic-explanation-panel"><strong>한 줄 결론</strong><p>{aiSummary.summary || '현재 입력된 조건을 기준으로 자산 흐름을 정리했어요.'}</p></div><div className="metric-panel"><span className="metric-panel-badge">{aiSummary.productType || '상품 유형'}</span><div className="metric-cards">{aiSummary.keyMetrics?.map((metric, index) => <div className="metric-card" key={`${metric.label}-${index}`}><span className="metric-label">{metric.label}</span><strong className="metric-value">{formatMetricValue(Number(metric.value) || 0, metric.unit)}<small>{metric.unit || '원'}</small></strong></div>)}</div></div>{aiSummary.visualizations?.map((chart, index) => <div key={`${chart.title}-${index}`} className="data-visualization-panel">{renderVisualization(chart)}</div>)}<div className="comic-explanation-panel"><strong>쉬운 해석</strong>{aiSummary.explanation?.map((entry, index) => <p key={`${entry}-${index}`}>{entry}</p>)}</div>{aiSummary.simple_terms && aiSummary.simple_terms.length > 0 && <div className="comic-explanation-panel"><strong>금융용어 쉬운 설명</strong><div className="term-cards">{aiSummary.simple_terms.map((term, index) => <div className="term-card" key={`${term.term}-${index}`}><span className="term-name">{term.term}</span><p className="term-meaning">{term.meaning}</p></div>)}</div></div>}{formulaGuide && <div className="comic-explanation-panel"><strong>계산 공식</strong><div className="term-cards">{formulaGuide.terms.map((term, index) => <div className="term-card" key={`${term.symbol}-${index}`}><span className="term-name">{term.symbol}</span><p className="term-meaning">{term.meaning}</p></div>)}</div><div className="formula-list">{formulaSteps.map((row, index) => <div className="formula-row" key={`${row.label}-${index}`}><span className="formula-label">{row.label}</span><code className="formula-expr">{row.formula}</code><span className="formula-substituted">{row.substituted} = <b>{row.result}</b></span></div>)}</div>{formulaGuide.note && <p className="formula-note">{formulaGuide.note}</p>}</div>}<div className="comic-explanation-panel"><strong>주의해야 할 조건</strong>{aiSummary.cautions?.map((entry, index) => <p key={`${entry}-${index}`}>{entry}</p>)}</div></div> : aiImage && imageSrc ? <div className="comic-image-shell"><img src={imageSrc} alt="AI 생성 자산 차트" className="comic-image" /><div className="comic-panel-selector">{comicPanels.map((panel, index) => <button type="button" key={`${panel.label}-${index}`} className={`comic-selector ${active === index ? 'selected' : ''}`} onClick={() => setActive(index)}><span>{panel.label}</span><em>{panel.title}</em></button>)}</div>{activePanel && <div className="comic-explanation-panel"><strong>왜 이런 컷이 나왔을까요?</strong><p>{activePanel.image_reason || activePanel.explanation || '이 장면은 자산 흐름과 상품 조건을 해석한 결과입니다.'}</p>{activePanel.glossary && activePanel.glossary.length > 0 && <div className="comic-glossary"><strong>간단 용어 정리</strong>{activePanel.glossary.map(term => <div className="comic-glossary-item" key={`${activePanel.label}-${term.term}`}><span>{term.term}</span><p>{term.meaning}</p></div>)}</div>}</div>}</div> : <div className="comic-grid">{comicPanels.map((panel, index) => <button type="button" key={`${panel.label}-${index}`} className={`comic-panel ${active === index ? 'selected' : ''}`} onClick={() => setActive(index)}><div className="comic-panel-header"><span>{panel.label}</span><span>구간 {index + 1}</span></div><div className="comic-visual"><Icon type={index === 0 ? 'wallet' : index === 1 ? 'shield' : index === 2 ? 'chart' : 'star'} /><div className="comic-visual-note">{panel.text || '자산 흐름'}</div></div><h3>{panel.title}</h3><p>{panel.text}</p>{active === index && <div className="comic-explanation"><strong>왜 이런 구간이 나왔을까요?</strong><span>{panel.image_reason || panel.explanation || '이 장면은 자산과 금융상품의 상황을 해석한 결과입니다.'}</span>{panel.glossary && panel.glossary.length > 0 && <div className="comic-glossary"><strong>간단 용어 정리</strong>{panel.glossary.map(term => <div className="comic-glossary-item" key={`${panel.label}-${term.term}`}><span>{term.term}</span><p>{term.meaning}</p></div>)}</div>}</div>}</button>)}</div>}</div>{!aiLoading && !aiError && !aiSummary && <div className="comic-footer-note">{activePanel?.image_reason || activePanel?.explanation || '자산 흐름과 조건을 함께 본다는 점을 기억해 주세요.'}</div>}</section><section className="result-grid"><div className="summary-card"><div className="card-heading"><div><span className="number-dot">2</span><h3>이야기 한눈에 보기</h3></div><span className="soft-label">COMIC SUMMARY</span></div><div className="result-main"><div><span className="muted">{monthLabel(totalMonths)} 후 {isLoanCategory ? '예상 총 상환액' : '예상 자산'}</span><strong>{money(finalValue)}<small>원</small></strong></div><div className="return-pill">{isLoanCategory ? '총 이자 부담률' : '예상 수익률'} <b>{percent(totalReturn)}</b></div></div><div className="chart"><div className="chart-y"><span>{money(maxPoint)}</span><span>{money(maxPoint / 2)}</span><span>0</span></div><svg viewBox="0 0 500 160" preserveAspectRatio="none" role="img" aria-label={isLoanCategory ? "기간별 상환 부담 증가 그래프" : "기간별 예상 자산 증가 그래프"}>{(() => { const stepX = points.length > 1 ? 500 / (points.length - 1) : 0; const coords = points.map((p, i) => ({ x: i * stepX, y: 160 - p / maxPoint * 135 })); const line = coords.map(c => `${c.x} ${c.y}`).join(' L '); return <><path d={`M 0 160 L ${line} L ${coords[coords.length - 1]?.x ?? 500} 160 Z`} fill="var(--color-accent)" opacity=".16" /><path d={`M ${line}`} fill="none" stroke="var(--color-accent)" strokeWidth="3" vectorEffect="non-scaling-stroke" />{coords.map((c, i) => <circle key={i} cx={c.x} cy={c.y} r="4" fill="var(--color-surface)" stroke="var(--color-accent)" strokeWidth="3" vectorEffect="non-scaling-stroke" />)}</> })()}</svg><div className="chart-x">{monthSteps.map((m, i) => <span key={`${m}-${i}`}>{monthLabel(m)}</span>)}</div></div><p className="disclaimer">{isLoanCategory ? '※ 원금은 유지하고 이자만 늘어난다고 가정한 단리 계산 결과이며, 실제 상환 방식에 따라 달라질 수 있어요.' : '※ 단순 복리 계산 결과이며 실제 적용 조건에 따라 달라질 수 있어요.'}</p></div><aside className="lesson-card"><span className="section-kicker">TODAY'S NOTE</span><h3>기억해 둘<br /><em>세 가지</em></h3><ul><li><b>01</b><span>공시 금리와 적용 조건을 함께 확인해요.</span></li><li><b>02</b><span>부채와 고정 지출을 고려해요.</span></li><li><b>03</b><span>나의 목표와 기간에 맞는 상품을 찾아요.</span></li></ul></aside></section><section className="history"><div className="history-head"><div><span className="section-kicker">MY NOTEBOOK</span><h2>최근 만든 이야기</h2></div><span className="history-count">{saved.length}개의 기록</span></div>{saved.length === 0 ? <div className="empty">0</div> : <div className="history-list">{saved.slice(0, 3).map(item => <button key={item.id} onClick={() => { setAssets(String(item.assets)); setMonths(String(Math.round(item.years * 12))); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><span className="history-icon">↗</span><span><b>{item.bank_name} · {item.product_name}</b><small>{money(item.assets)}원 · 연 {item.annual_rate}% · {monthLabel(Math.round(item.years * 12))}</small></span><span>→</span></button>)}</div>}</section></main><footer><span>돈길</span><span>이 서비스는 금융 이해를 돕기 위한 교육용 콘텐츠입니다.</span></footer></div>
}
