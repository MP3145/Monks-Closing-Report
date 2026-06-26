import React, { useState, useRef, useMemo } from "react";

const todayStr = () => {
  const d = new Date();
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
};
const dayName = () => new Date().toLocaleDateString("en-US", { weekday: "long" });

// ⚠️ Paste your Apps Script Web App URL here after deploying
const SHEET_ENDPOINT_URL = "https://script.google.com/macros/s/AKfycbzPOcsyLKz3pruZgOTsVBlC2R5hgPILHb0Rvac9DwHfOB1k5HsBdHc4suGtmgeO9a11fQ/exec";

const FIELD_DEFS = [
  { key: "cashInRegister", label: "Cash in Register", hint: "Includes catering cash payments. Don't subtract cash taken out." },
  { key: "creditCard", label: "Credit Card Transactions", hint: "From card machine" },
  { key: "cashSale", label: "Cash Sale", hint: "Cash sales today" },
  { key: "onlineOrders", label: "Online Orders", hint: "Uber / Grubhub / DoorDash / Website" },
  { key: "prevCarryOver", label: "Prev Day Carry Over Amount", hint: "" },
];

const PAYMENT_TYPES = ["Cash", "Credit Card", "Zelle", "Check", "Other"];

let cateringIdCounter = 1;
const newCateringLine = () => ({ id: cateringIdCounter++, name: "", amount: "", paymentType: "Cash" });

let cashOutIdCounter = 1;
const newCashOutLine = () => ({ id: cashOutIdCounter++, reason: "", amount: "" });

function toNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function fmt(n) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ClosingReport() {
  const [date, setDate] = useState(todayStr());
  const [day, setDay] = useState(dayName());
  const [closedBy, setClosedBy] = useState("");
  const [vals, setVals] = useState({});
  const [cateringLines, setCateringLines] = useState([newCateringLine()]);
  const [cashOutLines, setCashOutLines] = useState([newCashOutLine()]);
  const [showShare, setShowShare] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");
  const captureRef = useRef(null);

  const cateringTotal = useMemo(
    () => cateringLines.reduce((sum, line) => sum + toNum(line.amount), 0),
    [cateringLines]
  );

  // Catering paid by Card is already inside "Credit Card Transactions" — don't add again.
  // Catering paid by Cash, Zelle, Check, or Other is genuinely separate sales money —
  // "Cash in Register" is a drawer-reconciliation count, not a sales total, so cash
  // catering still needs to be added here to reach the real Total Reg Sale.
  const cateringExtra = useMemo(
    () =>
      cateringLines
        .filter((l) => l.paymentType !== "Credit Card")
        .reduce((sum, line) => sum + toNum(line.amount), 0),
    [cateringLines]
  );

  const cateringByPaymentType = useMemo(() => {
    const grouped = {};
    cateringLines.forEach((l) => {
      if (l.amount) {
        grouped[l.paymentType] = (grouped[l.paymentType] || 0) + toNum(l.amount);
      }
    });
    return grouped;
  }, [cateringLines]);

  const cashOutTotal = useMemo(
    () => cashOutLines.reduce((sum, line) => sum + toNum(line.amount), 0),
    [cashOutLines]
  );

  const totalRegSale = useMemo(() => {
    const c = toNum(vals.cashInRegister);
    const cc = toNum(vals.creditCard);
    const cs = toNum(vals.cashSale);
    const oo = toNum(vals.onlineOrders);
    return c + cc + cs + oo + cateringExtra;
  }, [vals, cateringExtra]);

  const finalSale = totalRegSale;

  // Cash Tips = Cash in Register − Prev Day Carry Over − Cash Sale
  // (Cash in Register is the gross count, before subtracting cash taken from counter)
  const cashTips = useMemo(() => {
    const cashInRegister = toNum(vals.cashInRegister);
    const prevCarryOver = toNum(vals.prevCarryOver);
    const cashSale = toNum(vals.cashSale);
    return cashInRegister - prevCarryOver - cashSale;
  }, [vals]);

  // Next Day Carry Over = Cash in Register − Cash Taken from Counter
  const nextCarryOver = useMemo(() => {
    const cashInRegister = toNum(vals.cashInRegister);
    return cashInRegister - cashOutTotal;
  }, [vals, cashOutTotal]);

  // CC Tips still manual since it comes from the card batch report, not derivable from these fields
  const [ccTips, setCcTips] = useState("");

  const set = (key, value) => setVals((v) => ({ ...v, [key]: value }));

  const updateCateringLine = (id, field, value) => {
    setCateringLines((lines) => lines.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  };
  const addCateringLine = () => setCateringLines((lines) => [...lines, newCateringLine()]);
  const removeCateringLine = (id) =>
    setCateringLines((lines) => (lines.length > 1 ? lines.filter((l) => l.id !== id) : lines));

  const updateCashOutLine = (id, field, value) => {
    setCashOutLines((lines) => lines.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  };
  const addCashOutLine = () => setCashOutLines((lines) => [...lines, newCashOutLine()]);
  const removeCashOutLine = (id) =>
    setCashOutLines((lines) => (lines.length > 1 ? lines.filter((l) => l.id !== id) : lines));

  const saveToSheet = async () => {
    setSaveStatus("saving");
    const payload = {
      date,
      day,
      cashInRegister: toNum(vals.cashInRegister),
      creditCard: toNum(vals.creditCard),
      cashSale: toNum(vals.cashSale),
      onlineOrders: toNum(vals.onlineOrders),
      prevCarryOver: toNum(vals.prevCarryOver),
      nextCarryOver,
      cateringTotal,
      cateringDetail: cateringLines
        .filter((l) => l.name || l.amount)
        .map((l) => `${l.name || "Untitled"} [${l.paymentType}]: $${fmt(toNum(l.amount))}`)
        .join(" | "),
      cashOutTotal,
      cashOutDetail: cashOutLines
        .filter((l) => l.reason || l.amount)
        .map((l) => `${l.reason || "Unspecified"}: $${fmt(toNum(l.amount))}`)
        .join(" | "),
      totalRegSale,
      ccTips: toNum(ccTips),
      cashTips,
      finalSale,
      closedBy,
    };

    try {
      if (SHEET_ENDPOINT_URL.startsWith("PASTE_")) {
        setSaveStatus("error");
        return false;
      }
      await fetch(SHEET_ENDPOINT_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(payload),
      });
      setSaveStatus("saved");
      return true;
    } catch (err) {
      setSaveStatus("error");
      return false;
    }
  };

  const handleGenerate = async () => {
    await saveToSheet();
    setShowShare(true);
  };

  const downloadAsImage = () => {
    const W = 760;
    const PAD = 48;
    const lineH = 30;

    // Pre-calculate how tall the canvas needs to be based on content
    let rowCount = FIELD_DEFS.length;
    if (filledCatering.length) rowCount += filledCatering.length + 2;
    if (filledCashOut.length) rowCount += filledCashOut.length + 2;
    const H = 480 + rowCount * lineH;

    const canvas = document.createElement("canvas");
    canvas.width = W * 2;
    canvas.height = H * 2;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);

    // Background
    ctx.fillStyle = "#fdfaf4";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#2b2118";
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, W - 8, H - 8);

    let y = PAD;

    // Header
    ctx.textAlign = "center";
    ctx.fillStyle = "#2b2118";
    ctx.font = "bold 30px Georgia, serif";
    ctx.fillText("MONKS PEARLAND", W / 2, y);
    y += 26;
    ctx.font = "600 13px Arial";
    ctx.fillStyle = "#a8763e";
    ctx.fillText("D A I L Y   C L O S I N G   R E P O R T", W / 2, y);
    y += 18;
    ctx.strokeStyle = "#2b2118";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    y += 36;

    // Date / Day
    ctx.textAlign = "left";
    ctx.font = "bold 16px Arial";
    ctx.fillStyle = "#2b2118";
    ctx.fillText(`Date: ${date}`, PAD, y);
    ctx.textAlign = "right";
    ctx.fillText(`Day: ${day}`, W - PAD, y);
    y += 30;

    // Field rows
    ctx.font = "15px Arial";
    FIELD_DEFS.forEach((f) => {
      ctx.textAlign = "left";
      ctx.fillStyle = "#3a2f22";
      ctx.fillText(f.label, PAD, y);
      ctx.textAlign = "right";
      ctx.font = "600 15px Arial";
      ctx.fillText(`$${fmt(toNum(vals[f.key]))}`, W - PAD, y);
      ctx.font = "15px Arial";
      ctx.strokeStyle = "#e0d8c8";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, y + 10);
      ctx.lineTo(W - PAD, y + 10);
      ctx.stroke();
      y += lineH;
    });
    y += 10;

    // Catering block
    if (filledCatering.length) {
      ctx.fillStyle = "#f1e8d8";
      ctx.fillRect(PAD - 12, y - 18, W - (PAD - 12) * 2, (filledCatering.length + 1) * lineH + 14);
      ctx.textAlign = "left";
      ctx.font = "600 12px Arial";
      ctx.fillStyle = "#a8763e";
      ctx.fillText("CATERING ORDERS", PAD, y);
      y += 24;
      ctx.font = "14px Arial";
      filledCatering.forEach((l) => {
        ctx.textAlign = "left";
        ctx.fillStyle = "#3a2f22";
        ctx.fillText(`${l.name || "Untitled"} (${l.paymentType})`, PAD, y);
        ctx.textAlign = "right";
        ctx.font = "600 14px Arial";
        ctx.fillText(`$${fmt(toNum(l.amount))}`, W - PAD, y);
        ctx.font = "14px Arial";
        y += lineH - 4;
      });
      ctx.textAlign = "left";
      ctx.font = "bold 14px Arial";
      ctx.fillStyle = "#2b2118";
      ctx.fillText("Catering Total", PAD, y);
      ctx.textAlign = "right";
      ctx.fillText(`$${fmt(cateringTotal)}`, W - PAD, y);
      y += lineH + 14;
    }

    // Cash-out block
    if (filledCashOut.length) {
      ctx.fillStyle = "#f8e9e3";
      ctx.fillRect(PAD - 12, y - 18, W - (PAD - 12) * 2, (filledCashOut.length + 1) * lineH + 14);
      ctx.textAlign = "left";
      ctx.font = "600 12px Arial";
      ctx.fillStyle = "#c0562e";
      ctx.fillText("CASH TAKEN FROM COUNTER", PAD, y);
      y += 24;
      ctx.font = "14px Arial";
      filledCashOut.forEach((l) => {
        ctx.textAlign = "left";
        ctx.fillStyle = "#3a2f22";
        ctx.fillText(l.reason || "Unspecified", PAD, y);
        ctx.textAlign = "right";
        ctx.font = "600 14px Arial";
        ctx.fillText(`−$${fmt(toNum(l.amount))}`, W - PAD, y);
        ctx.font = "14px Arial";
        y += lineH - 4;
      });
      ctx.textAlign = "left";
      ctx.font = "bold 14px Arial";
      ctx.fillStyle = "#2b2118";
      ctx.fillText("Total Cash Out", PAD, y);
      ctx.textAlign = "right";
      ctx.fillText(`−$${fmt(cashOutTotal)}`, W - PAD, y);
      y += lineH + 14;
    }

    // Total Reg Sale banner
    ctx.fillStyle = "#2b2118";
    ctx.fillRect(PAD - 12, y - 22, W - (PAD - 12) * 2, 40);
    ctx.textAlign = "left";
    ctx.font = "bold 15px Arial";
    ctx.fillStyle = "#fdfaf4";
    ctx.fillText("TOTAL REG SALE", PAD, y);
    ctx.textAlign = "right";
    ctx.font = "bold 17px Arial";
    ctx.fillText(`$${fmt(totalRegSale)}`, W - PAD, y);
    y += 50;

    // Tips boxes
    const boxW = (W - PAD * 2 - 16) / 2;
    ctx.strokeStyle = "#2b2118";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(PAD, y - 16, boxW, 50);
    ctx.strokeRect(PAD + boxW + 16, y - 16, boxW, 50);

    ctx.textAlign = "left";
    ctx.font = "600 11px Arial";
    ctx.fillStyle = "#a8763e";
    ctx.fillText("CC TIPS", PAD + 12, y);
    ctx.fillText("CASH TIPS", PAD + boxW + 28, y);

    ctx.font = "bold 18px Arial";
    ctx.fillStyle = "#2b2118";
    ctx.fillText(`$${fmt(toNum(ccTips))}`, PAD + 12, y + 24);
    ctx.fillText(`$${fmt(cashTips)}`, PAD + boxW + 28, y + 24);
    y += 64;

    // Final sale
    ctx.strokeStyle = "#2b2118";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(PAD, y - 18);
    ctx.lineTo(W - PAD, y - 18);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.font = "bold 17px Arial";
    ctx.fillText("FINAL SALE", PAD, y);
    ctx.textAlign = "right";
    ctx.fillText(`$${fmt(finalSale)}`, W - PAD, y);
    y += 32;

    ctx.textAlign = "left";
    ctx.font = "14px Arial";
    ctx.fillStyle = "#5a4d3c";
    ctx.fillText("Next Day Carry Over", PAD, y);
    ctx.textAlign = "right";
    ctx.font = "600 14px Arial";
    ctx.fillText(`$${fmt(nextCarryOver)}`, W - PAD, y);
    y += 36;

    ctx.textAlign = "left";
    ctx.font = "13px Arial";
    ctx.fillStyle = "#7a6b56";
    ctx.fillText(`Report closed by: ${closedBy || "—"}`, PAD, y);

    // Trigger download
    const link = document.createElement("a");
    link.download = `Monks-Closing-${date.replace(/\//g, "-")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const filledCatering = cateringLines.filter((l) => l.name || l.amount);
  const filledCashOut = cashOutLines.filter((l) => l.reason || l.amount);

  if (showShare) {
    return (
      <div style={{ minHeight: "100vh", background: "#2b2118", padding: "24px 16px", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div
          ref={captureRef}
          style={{ maxWidth: 420, margin: "0 auto", background: "#fdfaf4", border: "2px solid #2b2118", padding: "28px 24px" }}
        >
          <div style={{ textAlign: "center", borderBottom: "3px solid #2b2118", paddingBottom: 14, marginBottom: 18 }}>
            <div style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 700, letterSpacing: 1, color: "#2b2118" }}>
              MONKS PEARLAND
            </div>
            <div style={{ fontSize: 11, letterSpacing: 3, color: "#a8763e", marginTop: 4, textTransform: "uppercase" }}>
              Daily Closing Report
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#2b2118", marginBottom: 16 }}>
            <span><strong>Date:</strong> {date}</span>
            <span><strong>Day:</strong> {day}</span>
          </div>

          <div style={{ marginBottom: 10 }}>
            {FIELD_DEFS.map((f) => (
              <div key={f.key} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #e0d8c8", fontSize: 13.5, color: "#3a2f22" }}>
                <span>{f.label}</span>
                <span style={{ fontWeight: 600 }}>${fmt(toNum(vals[f.key]))}</span>
              </div>
            ))}
          </div>

          {filledCatering.length > 0 && (
            <div style={{ marginBottom: 10, background: "#f1e8d8", padding: "8px 10px", borderRadius: 4 }}>
              <div style={{ fontSize: 11, letterSpacing: 1, color: "#a8763e", textTransform: "uppercase", marginBottom: 4 }}>
                Catering Orders
              </div>
              {filledCatering.map((l) => (
                <div key={l.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#3a2f22", padding: "2px 0" }}>
                  <span>{l.name || "Untitled"} <span style={{ color: "#a8763e", fontSize: 11 }}>({l.paymentType})</span></span>
                  <span style={{ fontWeight: 600 }}>${fmt(toNum(l.amount))}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: "#2b2118", marginTop: 4, borderTop: "1px solid #ddd0b3", paddingTop: 4 }}>
                <span>Catering Total</span>
                <span>${fmt(cateringTotal)}</span>
              </div>
            </div>
          )}

          {filledCashOut.length > 0 && (
            <div style={{ marginBottom: 10, background: "#f8e9e3", padding: "8px 10px", borderRadius: 4 }}>
              <div style={{ fontSize: 11, letterSpacing: 1, color: "#c0562e", textTransform: "uppercase", marginBottom: 4 }}>
                Cash Taken from Counter
              </div>
              {filledCashOut.map((l) => (
                <div key={l.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#3a2f22", padding: "2px 0" }}>
                  <span>{l.reason || "Unspecified"}</span>
                  <span style={{ fontWeight: 600 }}>−${fmt(toNum(l.amount))}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: "#2b2118", marginTop: 4, borderTop: "1px solid #e3c9bb", paddingTop: 4 }}>
                <span>Total Cash Out</span>
                <span>−${fmt(cashOutTotal)}</span>
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", background: "#2b2118", color: "#fdfaf4", padding: "10px 12px", fontSize: 14, fontWeight: 700, marginBottom: 14 }}>
            <span>TOTAL REG SALE</span>
            <span>${fmt(totalRegSale)}</span>
          </div>

          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1, border: "1px solid #2b2118", padding: "8px 10px" }}>
              <div style={{ fontSize: 10, letterSpacing: 1, color: "#a8763e", textTransform: "uppercase" }}>CC Tips</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#2b2118" }}>${fmt(toNum(ccTips))}</div>
            </div>
            <div style={{ flex: 1, border: "1px solid #2b2118", padding: "8px 10px" }}>
              <div style={{ fontSize: 10, letterSpacing: 1, color: "#a8763e", textTransform: "uppercase" }}>Cash Tips</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#2b2118" }}>${fmt(cashTips)}</div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "3px solid #2b2118", paddingTop: 12, fontSize: 16, fontWeight: 700, color: "#2b2118" }}>
            <span>FINAL SALE</span>
            <span>${fmt(finalSale)}</span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13, color: "#5a4d3c" }}>
            <span>Next Day Carry Over</span>
            <span style={{ fontWeight: 600 }}>${fmt(nextCarryOver)}</span>
          </div>

          <div style={{ marginTop: 18, fontSize: 12, color: "#7a6b56" }}>
            Report closed by: <strong style={{ color: "#2b2118" }}>{closedBy || "—"}</strong>
          </div>
        </div>

        {saveStatus === "saved" && (
          <p style={{ maxWidth: 420, margin: "14px auto 0", textAlign: "center", color: "#8fbf8f", fontSize: 13 }}>
            ✓ Saved to Google Sheet
          </p>
        )}
        {saveStatus === "error" && (
          <p style={{ maxWidth: 420, margin: "14px auto 0", textAlign: "center", color: "#e08a6b", fontSize: 13 }}>
            ⚠ Couldn't save to sheet automatically — save the image and send it manually.
          </p>
        )}

        <div style={{ maxWidth: 420, margin: "20px auto 0", display: "flex", gap: 10 }}>
          <button
            onClick={() => setShowShare(false)}
            style={{ flex: 1, padding: "14px", borderRadius: 8, border: "1px solid #fdfaf4", background: "transparent", color: "#fdfaf4", fontSize: 14, fontWeight: 600 }}
          >
            ← Back to edit
          </button>
          <button
            onClick={downloadAsImage}
            style={{ flex: 1, padding: "14px", borderRadius: 8, border: "none", background: "#c0562e", color: "#fdfaf4", fontSize: 14, fontWeight: 700 }}
          >
            Save image
          </button>
        </div>
        <p style={{ maxWidth: 420, margin: "14px auto 0", textAlign: "center", color: "#a8967e", fontSize: 12, lineHeight: 1.5 }}>
          Tap "Save image," then open WhatsApp and attach it like any photo — or screenshot this screen directly.
        </p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f3eee3", fontFamily: "'Inter', system-ui, sans-serif", paddingBottom: 100 }}>
      <div style={{ background: "#2b2118", padding: "20px 16px 18px", textAlign: "center" }}>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 700, letterSpacing: 1, color: "#fdfaf4" }}>
          MONKS PEARLAND
        </div>
        <div style={{ fontSize: 10.5, letterSpacing: 2.5, color: "#c0562e", marginTop: 3, textTransform: "uppercase" }}>
          Daily Closing Report
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "18px 16px" }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Date</label>
            <input value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Day</label>
            <input value={day} onChange={(e) => setDay(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          {FIELD_DEFS.map((f) => (
            <div key={f.key} style={{ marginBottom: 14 }}>
              <label style={labelStyle}>{f.label}{f.hint && <span style={{ color: "#a8967e", fontWeight: 400 }}> · {f.hint}</span>}</label>
              <div style={{ position: "relative" }}>
                <span style={dollarStyle}>$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={vals[f.key] || ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  style={{ ...inputStyle, paddingLeft: 28 }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Catering Orders Section */}
        <div style={{ marginBottom: 18, background: "#fff", border: "1.5px solid #ddd2bd", borderRadius: 10, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "#2b2118" }}>Catering Orders</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#c0562e" }}>${fmt(cateringTotal)}</span>
          </div>

          {cateringLines.map((line, idx) => (
            <div key={line.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: idx < cateringLines.length - 1 ? "1px dashed #e6ddc9" : "none" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                <input
                  placeholder={`Order / contact ${idx + 1}`}
                  value={line.name}
                  onChange={(e) => updateCateringLine(line.id, "name", e.target.value)}
                  style={{ ...inputStyle, flex: 1, padding: "10px 12px", fontSize: 14 }}
                />
                <button
                  onClick={() => removeCateringLine(line.id)}
                  style={{ border: "none", background: "transparent", color: "#a8967e", fontSize: 20, width: 28, height: 36, cursor: "pointer" }}
                  aria-label="Remove line"
                >
                  ×
                </button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <span style={{ ...dollarStyle, left: 10 }}>$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={line.amount}
                    onChange={(e) => updateCateringLine(line.id, "amount", e.target.value)}
                    style={{ ...inputStyle, paddingLeft: 24, padding: "10px 12px 10px 24px", fontSize: 14 }}
                  />
                </div>
                <select
                  value={line.paymentType}
                  onChange={(e) => updateCateringLine(line.id, "paymentType", e.target.value)}
                  style={{ ...inputStyle, flex: 1, padding: "10px 12px", fontSize: 14, appearance: "none" }}
                >
                  {PAYMENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}

          <button
            onClick={addCateringLine}
            style={{
              width: "100%", padding: "10px", borderRadius: 8, border: "1.5px dashed #c0562e",
              background: "transparent", color: "#c0562e", fontSize: 13.5, fontWeight: 600, marginTop: 2
            }}
          >
            + Add another catering order
          </button>
        </div>

        {/* Cash Taken from Counter Section */}
        <div style={{ marginBottom: 22, background: "#fff", border: "1.5px solid #ddd2bd", borderRadius: 10, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "#2b2118" }}>Cash Taken from Counter</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#c0562e" }}>−${fmt(cashOutTotal)}</span>
          </div>
          <p style={{ fontSize: 11.5, color: "#a8967e", margin: "0 0 10px" }}>
            Salary advances, refunds, or any cash removed from the register — not a sale.
          </p>

          {cashOutLines.map((line, idx) => (
            <div key={line.id} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <input
                placeholder={`Reason (e.g. "Salary advance - Roshini")`}
                value={line.reason}
                onChange={(e) => updateCashOutLine(line.id, "reason", e.target.value)}
                style={{ ...inputStyle, flex: 1.4, padding: "10px 12px", fontSize: 14 }}
              />
              <div style={{ position: "relative", flex: 1 }}>
                <span style={{ ...dollarStyle, left: 10 }}>$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={line.amount}
                  onChange={(e) => updateCashOutLine(line.id, "amount", e.target.value)}
                  style={{ ...inputStyle, paddingLeft: 24, padding: "10px 12px 10px 24px", fontSize: 14 }}
                />
              </div>
              <button
                onClick={() => removeCashOutLine(line.id)}
                style={{ border: "none", background: "transparent", color: "#a8967e", fontSize: 20, width: 28, height: 36, cursor: "pointer" }}
                aria-label="Remove line"
              >
                ×
              </button>
            </div>
          ))}

          <button
            onClick={addCashOutLine}
            style={{
              width: "100%", padding: "10px", borderRadius: 8, border: "1.5px dashed #c0562e",
              background: "transparent", color: "#c0562e", fontSize: 13.5, fontWeight: 600, marginTop: 2
            }}
          >
            + Add another cash-out entry
          </button>

          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginTop: 12, paddingTop: 10, borderTop: "1px dashed #e6ddc9"
          }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "#5a4d3c" }}>
              Next Day Carry Over <span style={{ color: "#a8967e", fontWeight: 400 }}>· auto</span>
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#2b2118" }}>${fmt(nextCarryOver)}</span>
          </div>
        </div>

        <div style={{
          background: "#2b2118", color: "#fdfaf4", borderRadius: 10,
          padding: "14px 16px", display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: 18
        }}>
          <span style={{ fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "#d8c9b3" }}>Total Reg Sale</span>
          <span style={{ fontSize: 22, fontWeight: 700 }}>${fmt(totalRegSale)}</span>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>CC Tips <span style={{ color: "#a8967e", fontWeight: 400 }}>· from card batch report</span></label>
            <div style={{ position: "relative" }}>
              <span style={dollarStyle}>$</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                value={ccTips}
                onChange={(e) => setCcTips(e.target.value)}
                style={{ ...inputStyle, paddingLeft: 28 }}
              />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Cash Tips <span style={{ color: "#a8967e", fontWeight: 400 }}>· auto-calculated</span></label>
            <div style={{
              ...inputStyle, display: "flex", alignItems: "center",
              background: "#f1e8d8", color: "#2b2118", fontWeight: 700
            }}>
              ${fmt(cashTips)}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Report closed by</label>
          <input
            value={closedBy}
            onChange={(e) => setClosedBy(e.target.value)}
            placeholder="Staff name"
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "#f3eee3", borderTop: "1px solid #ddd2bd",
        padding: "12px 16px 18px", display: "flex", justifyContent: "center"
      }}>
        <button
          onClick={handleGenerate}
          disabled={saveStatus === "saving"}
          style={{
            maxWidth: 480, width: "100%", padding: "16px",
            borderRadius: 10, border: "none", background: saveStatus === "saving" ? "#a8763e" : "#c0562e",
            color: "#fdfaf4", fontSize: 16, fontWeight: 700, letterSpacing: 0.3
          }}
        >
          {saveStatus === "saving" ? "Saving..." : "Save & generate report"}
        </button>
      </div>
    </div>
  );
}

const labelStyle = {
  display: "block", fontSize: 12.5, fontWeight: 600,
  color: "#5a4d3c", marginBottom: 6, letterSpacing: 0.2
};

const inputStyle = {
  width: "100%", padding: "12px 14px", borderRadius: 8,
  border: "1.5px solid #ddd2bd", fontSize: 16, background: "#fff",
  color: "#2b2118", boxSizing: "border-box"
};

const dollarStyle = {
  position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
  color: "#a8967e", fontSize: 16, fontWeight: 600
};
