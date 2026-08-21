from backend.main import ComicInput, build_financial_coach_summary, build_story_panels


def test_build_story_panels_has_four_readable_steps_with_asset_progression():
    item = ComicInput(
        assets=10000000,
        product_name='청년 우대 적금',
        bank_name='국민은행',
        product_category='적금',
        annual_rate=4.2,
        years=3,
        job='회사원',
        income_level='월 400~700만원',
        credit_score=820,
        debt=2000000,
        monthly_expenses=280000,
        savings_level='월 10~50만원',
        product_details={}
    )

    panels = build_story_panels(item)

    assert len(panels) == 4
    assert all(panel['title'] for panel in panels)
    assert all(panel['explanation'] for panel in panels)
    assert all(panel.get('image_reason') for panel in panels)
    assert all(panel.get('glossary') for panel in panels)
    assert panels[0]['numbers']['current_assets'] == 10000000
    assert panels[-1]['numbers']['projected_assets'] > panels[0]['numbers']['current_assets']
    assert any('자산' in panel['title'] for panel in panels)
    assert any(term['term'] == '복리' for panel in panels for term in panel['glossary'])


def test_comic_input_accepts_loan_specific_values_and_summary_uses_them():
    item = ComicInput(
        assets=50000000,
        product_name='주택담보대출 2안',
        bank_name='우리은행',
        product_category='주택담보대출',
        annual_rate=3.8,
        years=20,
        job='회사원',
        income_level='월 500~700만원',
        credit_score=780,
        debt=15000000,
        monthly_expenses=220000,
        savings_level='월 20만원',
        product_details={},
        house_price=700000000,
        mortgage_down_payment=100000000,
        mortgage_loan_amount=600000000,
        mortgage_monthly_income=7000000,
        mortgage_monthly_expenses=2200000,
        mortgage_existing_debt=15000000,
    )

    summary = build_financial_coach_summary(item)

    assert item.mortgage_loan_amount == 600000000
    assert '월 상환' in summary['summary'] or '월 부담' in summary['summary']
    assert any(metric['label'] in {'대출 원금', '대출금액'} for metric in summary['keyMetrics'])
    assert any(chart['title'] == '월 부담 비교' for chart in summary['visualizations'])
