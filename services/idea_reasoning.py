"""Rich reasoning generator for Alpha Ideas — each strategy gets contextual, varied reasoning."""

def breakout_reason(s):
    r = "Breaking 20-day high on " + str(round(s.get("vol_ratio", 0), 1)) + "x avg volume. "
    rsi = s.get("rsi", 50)
    r += "RSI at " + str(round(rsi)) + " "
    r += ("has room to run. " if rsi < 65 else "strong but watch for pullback. ")
    if s.get("above_200dma") and s.get("above_50dma"):
        r += "Above both 50 and 200 DMA confirming uptrend. "
    if s.get("above_supertrend"):
        r += "Supertrend bullish. "
    if s.get("pct_from_52h", -99) > -5:
        r += "Near 52-week high territory. "
    elif s.get("pct_from_52l", 0) > 30:
        r += str(round(s.get("pct_from_52l", 0))) + "% above 52W low showing sustained recovery. "
    if s.get("macd_cross_up"):
        r += "MACD just crossed bullish. "
    r += s.get("sector", "") + " sector."
    return r

def reversion_reason(s):
    rsi = s.get("rsi", 50)
    r = "RSI oversold at " + str(round(rsi)) + " near Bollinger lower band. "
    r += str(abs(round(s.get("pct_from_52h", 0)))) + "% below 52W high -- potential value entry. "
    if s.get("above_200dma"):
        r += "Still above 200 DMA acting as strong support. "
    r += "Target: mean reversion to 50 DMA (" + str(round(s.get("sma_50", 0))) + "). "
    if s.get("vol_ratio", 0) > 1.3:
        r += "Volume surge suggests institutional interest at these levels. "
    r += s.get("sector", "") + " sector."
    return r

def momentum_reason(s):
    r = "Minervini template " + str(s.get("minervini_score", 0)) + "/7 satisfied. "
    rs3 = s.get("rs_3m", 0)
    if rs3 > 30:
        r += "Sector leader -- outperforming market by +" + str(round(rs3)) + "% over 3M. "
    elif rs3 > 15:
        r += "Strong relative strength +" + str(round(rs3)) + "% over 3M. "
    else:
        r += "RS +" + str(round(rs3)) + "% over 3M. "
    if s.get("above_supertrend") and s.get("macd_hist", 0) > 0:
        r += "Supertrend + MACD both confirm bullish. "
    if s.get("pct_from_52h", -99) > -10:
        r += "Within " + str(abs(round(s.get("pct_from_52h", 0)))) + "% of 52W high. "
    r += "Above all key MAs -- trend continuation. " + s.get("sector", "") + " sector."
    return r

def squeeze_reason(s):
    bw = s.get("bb_width", 0)
    r = "Bollinger Bands squeezed to " + str(round(bw, 1)) + "% width -- lowest volatility phase. "
    r += "Historically precedes explosive directional moves. "
    if s.get("above_200dma") and s.get("above_50dma"):
        r += "Above both key MAs -- bias UP when squeeze resolves. "
    r += "RSI neutral at " + str(round(s.get("rsi", 0))) + ". "
    if s.get("vol_ratio", 0) < 0.8:
        r += "Declining volume confirms coiling pattern. "
    r += s.get("sector", "") + " sector."
    return r

def quality_reason(s, roe, roce, pe, margin, rev_g, de):
    r = "Quality compounder: ROE " + str(round(roe)) + "%, ROCE " + str(round(roce)) + "%. "
    if pe < 25:
        r += "Reasonably valued at PE " + str(round(pe)) + "x. "
    if margin > 15:
        r += "High-margin business at " + str(round(margin)) + "% EBITDA. "
    if rev_g > 15:
        r += "Growing revenue at " + str(round(rev_g)) + "% YoY. "
    elif rev_g > 8:
        r += "Steady growth at " + str(round(rev_g)) + "% YoY. "
    if de is not None and de < 0.3:
        r += "Nearly debt-free. "
    elif de is not None and de < 0.7:
        r += "Low leverage adds safety. "
    r += "Technically confirmed: RS +" + str(round(s.get("rs_3m", 0))) + "% 3M, Minervini " + str(s.get("minervini_score", 0)) + "/7. "
    r += s.get("sector", "") + " sector."
    return r

def value_reason(s, pe, pb, roe, de, div_y, ev_ebitda):
    r = "Deep value: PE " + str(round(pe)) + "x, PB " + str(round(pb, 1)) + "x -- well below market averages. "
    if roe > 12:
        r += "Profitable at ROE " + str(round(roe)) + "% -- not a value trap. "
    if de is not None and de < 0.3:
        r += "Virtually debt-free. "
    if div_y > 1.5:
        r += "Dividend yield " + str(round(div_y, 1)) + "% provides downside cushion. "
    if 0 < ev_ebitda < 10:
        r += "EV/EBITDA " + str(round(ev_ebitda)) + "x signals undervaluation. "
    if s.get("above_200dma"):
        r += "Above 200 DMA. "
    else:
        r += "Watch for trend reversal catalyst. "
    r += s.get("sector", "") + " sector."
    return r

def garp_reason(s, pe, calc_peg, growth, roe, margin, rev_g):
    r = "GARP: PEG " + str(round(calc_peg, 1)) + "x (PE " + str(round(pe)) + "x / " + str(round(growth)) + "% growth). "
    if calc_peg < 1:
        r += "PEG below 1 -- growth is underpriced. "
    if roe > 15:
        r += "High-quality business, ROE " + str(round(roe)) + "%. "
    if margin > 15:
        r += "Healthy margins at " + str(round(margin)) + "%. "
    if rev_g > 20:
        r += "Revenue accelerating " + str(round(rev_g)) + "% YoY. "
    if s.get("above_200dma") and s.get("rs_3m", 0) > 10:
        r += "Technically confirmed, RS +" + str(round(s.get("rs_3m", 0))) + "%. "
    r += s.get("sector", "") + " sector."
    return r
