// MẪU VIẾT INDICATOR — copy file này thành tên mới (không bắt đầu bằng "_"), ví dụ my_indicator.js,
// sửa lại rồi F5 trình duyệt. Mọi file *.js trong thư mục này (trừ file bắt đầu bằng "_") được nạp tự động.
//
// FX.indicator({...}) nhận:
//   id          : mã duy nhất (không trùng file khác)
//   name        : tên hiển thị
//   description : mô tả ngắn (hiện trong hộp chọn Indicators)
//   pane        : 'main' = vẽ đè lên chart giá, 'sub' = khung riêng bên dưới (như RSI, MACD)
//   precision   : số chữ số thập phân khi pane = 'sub' (mặc định 2)
//   range       : [min, max] cố định trục giá cho pane 'sub' (ví dụ [0, 100] cho RSI)
//   levels      : các đường ngang mờ cho pane 'sub' (ví dụ [70, 30])
//   params      : danh sách tham số chỉnh được trong nút ⚙
//                 { id, label, type: 'number' | 'source' | 'select' | 'bool', default, min, max, step, options }
//                 type 'source' cho phép chọn close/open/high/low/hl2/hlc3/ohlc4
//   plots       : các đường sẽ vẽ
//                 { id, title, color: '#rrggbb', type: 'line' | 'histogram', lineWidth (1-4, mặc định; người dùng chỉnh lại trong ⚙),
//                   style: 'solid'|'dashed'|'dotted',
//                   colors: ['#màu khi >= 0', '#màu khi < 0'] (chỉ cho histogram) }
//                 legend: false để không hiện giá trị đường đó trên legend
//   params      : có thêm type 'color' (ô chọn màu) và 'text' (ô chữ); thêm group: 'Tên nhóm' để chia nhóm trong ⚙
//   compute(bars, p, ta) : trả về object { [plot.id]: mảng số cùng độ dài với bars, null = không vẽ }
//                 bars[i] = { time, open, high, low, close }, p = giá trị params, ta = thư viện hàm
//                 Thêm khóa barColor: mảng màu '#rrggbb' | null để tô màu nến (giống barcolor() của Pine).
//                 Có thể trả thêm dữ liệu tùy ý, hàm draw() đọc lại qua h.res.
//   draw(ctx, h) : (tùy chọn) tự vẽ lên canvas NẰM DƯỚI nến — dùng cho fill giữa 2 đường, hộp phiên, nhãn, đường dọc...
//                 h.x(i) / h.y(giá) đổi chỉ số nến / giá ra pixel; h.from..h.to = các nến đang thấy (đã giới hạn < h.end)
//                 h.end = số nến đã hiện (replay) — KHÔNG đọc bars[i] với i >= h.end để không lộ tương lai
//                 h.fillBetween(mảngA, mảngB, màu)  h.text(chữ, x, y, màu, align, baseline, font)  h.hexA('#rrggbb', alpha)
//                 h.bars, h.t (giờ UTC giây), h.params, h.res, h.width, h.height, h.tfSec, h.pip, h.barSpacing
//   recompute   : true nếu indicator "nhìn trước" (dùng nến tương lai, ví dụ pivot/zigzag).
//                 Khi đó app tính lại trên đúng các nến đã hiện mỗi bước replay để không lộ tương lai.
//                 Indicator bình thường (giá trị nến i chỉ dùng nến <= i) thì bỏ qua thuộc tính này.
//
// Thư viện ta (mọi hàm nhận/trả mảng):
//   ta.src(bars, 'close'|'open'|'high'|'low'|'hl2'|'hlc3'|'ohlc4')
//   ta.sma(a, n)  ta.ema(a, n)  ta.rma(a, n)  ta.wma(a, n)  ta.stdev(a, n)
//   ta.highest(a, n)  ta.lowest(a, n)  ta.change(a, k)  ta.rsi(a, n)
//   ta.tr(bars)  ta.atr(bars, n)
//   ta.add(a, b)  ta.sub(a, b)  ta.mul(a, b)   (b là mảng hoặc hằng số)

FX.indicator({
  id: 'template_hl_mid',
  name: 'Mẫu: Trung bình đỉnh-đáy',
  description: 'Ví dụ: đường giữa của đỉnh cao nhất và đáy thấp nhất N nến',
  pane: 'main',
  params: [
    { id: 'length', label: 'Số nến', type: 'number', default: 20, min: 1, step: 1 },
  ],
  plots: [
    { id: 'upper', title: 'Đỉnh', color: '#26a69a' },
    { id: 'mid', title: 'Giữa', color: '#f0b90b', style: 'dashed' },
    { id: 'lower', title: 'Đáy', color: '#ef5350' },
  ],
  compute(bars, p, ta) {
    const upper = ta.highest(ta.src(bars, 'high'), p.length);
    const lower = ta.lowest(ta.src(bars, 'low'), p.length);
    const mid = upper.map((u, i) => (u == null || lower[i] == null ? null : (u + lower[i]) / 2));
    return { upper, mid, lower };
  },
});
