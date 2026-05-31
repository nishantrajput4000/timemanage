import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const STORAGE_KEY = "time_audit_v2";
const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

function fmt(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function timeToMins(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function minsToTime(m) { return `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`; }
function todayKey() { return new Date().toISOString().slice(0, 10); }
function weekKey(date) {
  const d = new Date(date), day = d.getDay(), diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().slice(0, 10);
}
function monthKey(date) { return date.slice(0, 7); }
function dayLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function loadEntries() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function saveEntries(e) { localStorage.setItem(STORAGE_KEY, JSON.stringify(e)); }

const verdictColor = v => v === "Time Used" ? "#1D9E75" : v === "Physical Activity" ? "#F97316" : "#D85A30";
const verdictBg    = v => v === "Time Used" ? "rgba(29,158,117,0.2)" : v === "Physical Activity" ? "rgba(249,115,22,0.2)" : "rgba(216,90,48,0.2)";
const verdictText  = v => v === "Time Used" ? "#5DCAA5" : v === "Physical Activity" ? "#FDBA74" : "#F0997B";

export default function App() {
  const [entries, setEntries]       = useState(loadEntries);
  const [form, setForm]             = useState({ activity: "", start: "", end: "" });
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [tab, setTab]               = useState("log");
  const [analyticsView, setAView]   = useState("daily");

  useEffect(() => {
    const todays = loadEntries()
      .filter(e => e.date === todayKey())
      .sort((a, b) => timeToMins(a.start) - timeToMins(b.start));
    if (todays.length > 0) setForm(f => ({ ...f, start: todays[todays.length - 1].end }));
  }, []);

  function persist(updated) { setEntries(updated); saveEntries(updated); }

  async function analyze() {
    const { activity, start, end } = form;
    if (!activity.trim() || !start || !end) { setError("Please fill in all fields."); return; }
    if (timeToMins(end) <= timeToMins(start)) { setError("End time must be after start time."); return; }
    setError(""); setLoading(true);
    const duration = timeToMins(end) - timeToMins(start);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 300,
          system: `You are a brutally honest personal productivity coach. Respond ONLY with a JSON object, no markdown.

For PHYSICAL activities, check if the duration exceeds the recommended necessary time. If it does, split it:
{"verdict":"Split","physicalMins":<necessary minutes as number>,"wastedMins":<excess minutes as number>,"feedback":"One blunt sentence explaining the split, max 25 words."}

If no excess, return:
{"verdict":"Physical Activity","feedback":"One blunt sentence, max 25 words."}

For non-physical activities:
{"verdict":"Time Used" or "Time Wasted","feedback":"One blunt sentence, max 25 words."}

RECOMMENDED DURATIONS for physical activities (anything beyond = wasted):
- Sleep: 420 minutes (7 hours)
- Exercise / gym / workout: 60 minutes
- Bathing / shower: 15 minutes
- Eating (any meal): 30 minutes
- Washing face / skincare / grooming: 10 minutes
- Getting dressed: 10 minutes
- Cooking / preparing food: 45 minutes
- Using bathroom / toilet: 10 minutes
- Drinking (water, tea, etc.): 5 minutes
- Walking (leisure): 20 minutes

CATEGORIES:
"Physical Activity": ANYTHING involving the body within the recommended duration above.
"Time Used": ONLY activities that directly earn money OR build skills that will earn money — working, freelancing, studying a professional skill, taking a course, reading for career growth, coding, writing for income, business planning.
"Time Wasted": EVERYTHING else — talking to friends, socializing, scrolling, TV, gaming, hobbies, entertainment, shopping, religious activities, commuting.`,
          messages: [{ role: "user", content: `Activity: "${activity}", Duration: ${duration} minutes` }]
        })
      });
      const data = await res.json();
      const text = data.content.map(b => b.text || "").join("");
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      let newEntries = [];
      if (parsed.verdict === "Split") {
        const physEnd = minsToTime(timeToMins(start) + parsed.physicalMins);
        newEntries = [
          { id: Date.now(),     activity,               start,    end: physEnd, duration: parsed.physicalMins, verdict: "Physical Activity", feedback: parsed.feedback, date: todayKey() },
          { id: Date.now() + 1, activity: `${activity} (excess)`, start: physEnd, end, duration: parsed.wastedMins,  verdict: "Time Wasted",       feedback: `Exceeded recommended duration by ${parsed.wastedMins} min — this portion is wasted.`, date: todayKey() }
        ];
      } else {
        newEntries = [{ id: Date.now(), activity, start, end, duration, verdict: parsed.verdict, feedback: parsed.feedback, date: todayKey() }];
      }
      persist([...entries, ...newEntries]);
      setForm({ activity: "", start: end, end: "" });
      setTab("today");
    } catch { setError("Analysis failed. Please check your API key and try again."); }
    setLoading(false);
  }

  function del(id) { persist(entries.filter(e => e.id !== id)); }

  const todayEntries  = entries.filter(e => e.date === todayKey()).sort((a, b) => timeToMins(a.start) - timeToMins(b.start));
  const usedMins      = todayEntries.filter(e => e.verdict === "Time Used").reduce((s, e) => s + e.duration, 0);
  const wastedMins    = todayEntries.filter(e => e.verdict === "Time Wasted").reduce((s, e) => s + e.duration, 0);
  const physicalMins  = todayEntries.filter(e => e.verdict === "Physical Activity").reduce((s, e) => s + e.duration, 0);
  const totalMins     = usedMins + wastedMins + physicalMins;
  const usedPct       = totalMins ? Math.round((usedMins / totalMins) * 100) : 0;
  const physPct       = totalMins ? Math.round((physicalMins / totalMins) * 100) : 0;
  const wastedPct     = totalMins ? 100 - usedPct - physPct : 0;

  function getAnalyticsData() {
    const groups = {};
    entries.forEach(e => {
      const key = analyticsView === "daily" ? e.date : analyticsView === "weekly" ? weekKey(e.date) : monthKey(e.date);
      if (!groups[key]) groups[key] = { used: 0, wasted: 0, physical: 0 };
      if (e.verdict === "Time Used") groups[key].used += e.duration;
      else if (e.verdict === "Physical Activity") groups[key].physical += e.duration;
      else groups[key].wasted += e.duration;
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([key, val]) => ({
      label: analyticsView === "daily" ? dayLabel(key) : analyticsView === "weekly" ? `Wk ${key.slice(5,10)}` : key.slice(0,7),
      used:     Math.round(val.used     / 60 * 10) / 10,
      physical: Math.round(val.physical / 60 * 10) / 10,
      wasted:   Math.round(val.wasted   / 60 * 10) / 10,
    }));
  }

  const analyticsData = getAnalyticsData();
  const inp = { width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:10, padding:"10px 14px", color:"#fff", fontSize:14, outline:"none" };

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)", fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", padding:"1.5rem 1rem" }}>
      <div style={{ maxWidth:620, margin:"0 auto" }}>

        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:"1.5rem" }}>
          <div style={{ fontSize:36, marginBottom:6 }}>⏳</div>
          <h1 style={{ fontSize:26, fontWeight:600, color:"#fff", margin:"0 0 4px" }}>Time Audit</h1>
          <p style={{ fontSize:13, color:"rgba(255,255,255,0.5)", margin:0 }}>Every minute counts — make them count for you</p>
        </div>

        {/* Summary cards */}
        {totalMins > 0 && (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:"1rem" }}>
              {[
                { label:"Used",     value:fmt(usedMins),     color:"#1D9E75", bg:"rgba(29,158,117,0.15)"  },
                { label:"Physical", value:fmt(physicalMins), color:"#F97316", bg:"rgba(249,115,22,0.15)"  },
                { label:"Wasted",   value:fmt(wastedMins),   color:"#D85A30", bg:"rgba(216,90,48,0.15)"   },
                { label:"Score",    value:`${usedPct+physPct}%`, color:(usedPct+physPct)>=60?"#1D9E75":"#D85A30", bg:(usedPct+physPct)>=60?"rgba(29,158,117,0.15)":"rgba(216,90,48,0.15)" }
              ].map(c => (
                <div key={c.label} style={{ background:c.bg, border:`1px solid ${c.color}33`, borderRadius:12, padding:"12px 0", textAlign:"center" }}>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.5)", marginBottom:4, letterSpacing:0.5 }}>{c.label.toUpperCase()}</div>
                  <div style={{ fontSize:17, fontWeight:600, color:c.color }}>{c.value}</div>
                </div>
              ))}
            </div>
            <div style={{ height:8, borderRadius:99, background:"rgba(255,255,255,0.1)", overflow:"hidden", display:"flex", marginBottom:"0.5rem" }}>
              <div style={{ width:`${usedPct}%`,    background:"linear-gradient(90deg,#1D9E75,#5DCAA5)", transition:"width 0.6s" }} />
              <div style={{ width:`${physPct}%`,    background:"linear-gradient(90deg,#F97316,#FDBA74)", transition:"width 0.6s" }} />
              <div style={{ width:`${wastedPct}%`,  background:"linear-gradient(90deg,#D85A30,#F0997B)", transition:"width 0.6s" }} />
            </div>
            <div style={{ display:"flex", gap:14, marginBottom:"1.5rem", fontSize:11, color:"rgba(255,255,255,0.4)" }}>
              {[["#1D9E75","Used",usedPct],["#F97316","Physical",physPct],["#D85A30","Wasted",wastedPct]].map(([col,lbl,pct])=>(
                <span key={lbl} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ width:8, height:8, borderRadius:2, background:col, display:"inline-block" }} />{lbl} {pct}%
                </span>
              ))}
            </div>
          </>
        )}

        {/* Nav */}
        <div style={{ display:"flex", gap:8, marginBottom:"1.25rem", background:"rgba(255,255,255,0.05)", borderRadius:14, padding:6 }}>
          {[{id:"log",label:"Log",icon:"✏️"},{id:"today",label:"Today",icon:"📋"},{id:"analytics",label:"Analytics",icon:"📊"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              flex:1, padding:"9px 0", borderRadius:10, fontSize:13, cursor:"pointer", border:"none",
              background:tab===t.id?"rgba(255,255,255,0.15)":"transparent",
              color:tab===t.id?"#fff":"rgba(255,255,255,0.45)",
              fontWeight:tab===t.id?600:400
            }}>{t.icon} {t.label}</button>
          ))}
        </div>

        {/* LOG TAB */}
        {tab==="log" && (
          <div style={{ background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:16, padding:"1.5rem" }}>
            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:12, color:"rgba(255,255,255,0.5)", display:"block", marginBottom:6, letterSpacing:0.5 }}>ACTIVITY</label>
              <input type="text" placeholder="What did you do? e.g. Slept, Ate breakfast, Studied..."
                value={form.activity} onChange={e=>setForm(f=>({...f,activity:e.target.value}))}
                onKeyDown={e=>e.key==="Enter"&&analyze()} style={inp} />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
              {[["start","Start time"],["end","End time"]].map(([k,lbl])=>(
                <div key={k}>
                  <label style={{ fontSize:12, color:"rgba(255,255,255,0.5)", display:"block", marginBottom:6 }}>{lbl.toUpperCase()}</label>
                  <input type="time" value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{...inp,colorScheme:"dark"}} />
                </div>
              ))}
            </div>
            {error && <p style={{ fontSize:13, color:"#F0997B", marginBottom:12 }}>{error}</p>}
            <button onClick={analyze} disabled={loading} style={{
              width:"100%", padding:"12px", borderRadius:12, fontSize:14, cursor:loading?"not-allowed":"pointer",
              background:loading?"rgba(255,255,255,0.1)":"linear-gradient(135deg,#667eea,#764ba2)",
              color:"#fff", border:"none", fontWeight:600, opacity:loading?0.7:1
            }}>{loading?"🤖 AI is analyzing your activity...":"✨ Log & Analyze with AI"}</button>
            {todayEntries.length>0 && (
              <p style={{ fontSize:12, color:"rgba(255,255,255,0.35)", textAlign:"center", marginTop:10, marginBottom:0 }}>
                ⏱ Start time auto-resumed from: <strong style={{color:"rgba(255,255,255,0.5)"}}>{todayEntries[todayEntries.length-1].end}</strong>
              </p>
            )}
          </div>
        )}

        {/* TODAY TAB */}
        {tab==="today" && (
          <div>
            {todayEntries.length===0 ? (
              <div style={{ textAlign:"center", padding:"3rem 0", color:"rgba(255,255,255,0.35)", fontSize:14 }}>
                No activities logged today.<br />
                <button onClick={()=>setTab("log")} style={{ marginTop:12, padding:"8px 20px", borderRadius:10, fontSize:13, cursor:"pointer", background:"rgba(255,255,255,0.08)", color:"rgba(255,255,255,0.7)", border:"1px solid rgba(255,255,255,0.15)" }}>Start logging ↗</button>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {todayEntries.map(e=>(
                  <div key={e.id} style={{
                    background:"rgba(255,255,255,0.06)",
                    border:`1px solid ${verdictColor(e.verdict)}44`,
                    borderLeft:`3px solid ${verdictColor(e.verdict)}`,
                    borderRadius:14, padding:"14px 16px"
                  }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                      <div>
                        <div style={{ fontWeight:600, fontSize:15, color:"#fff" }}>{e.activity}</div>
                        <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", marginTop:2 }}>{e.start} – {e.end} · {fmt(e.duration)}</div>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:11, fontWeight:600, padding:"3px 10px", borderRadius:99, background:verdictBg(e.verdict), color:verdictText(e.verdict) }}>{e.verdict}</span>
                        <button onClick={()=>del(e.id)} style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.3)", fontSize:18, padding:0 }}>×</button>
                      </div>
                    </div>
                    <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", borderTop:"1px solid rgba(255,255,255,0.08)", paddingTop:8 }}>💬 {e.feedback}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ANALYTICS TAB */}
        {tab==="analytics" && (
          <div>
            <div style={{ display:"flex", gap:8, marginBottom:"1.25rem" }}>
              {["daily","weekly","monthly"].map(v=>(
                <button key={v} onClick={()=>setAView(v)} style={{
                  flex:1, padding:"8px 0", borderRadius:10, fontSize:13, cursor:"pointer",
                  background:analyticsView===v?"rgba(102,126,234,0.3)":"rgba(255,255,255,0.05)",
                  color:analyticsView===v?"#a78bfa":"rgba(255,255,255,0.4)",
                  border:analyticsView===v?"1px solid rgba(102,126,234,0.5)":"1px solid rgba(255,255,255,0.1)",
                  fontWeight:analyticsView===v?600:400, textTransform:"capitalize"
                }}>{v.charAt(0).toUpperCase()+v.slice(1)}</button>
              ))}
            </div>
            {analyticsData.length===0 ? (
              <div style={{ textAlign:"center", padding:"3rem 0", color:"rgba(255,255,255,0.3)", fontSize:14 }}>No data yet. Start logging activities!</div>
            ) : (
              <>
                <div style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:16, padding:"1.25rem 1rem 0.5rem", marginBottom:"1rem" }}>
                  <div style={{ display:"flex", gap:16, marginBottom:12, fontSize:12, color:"rgba(255,255,255,0.5)", flexWrap:"wrap" }}>
                    {[["#1D9E75","Used (hrs)"],["#F97316","Physical (hrs)"],["#D85A30","Wasted (hrs)"]].map(([col,lbl])=>(
                      <span key={lbl} style={{ display:"flex", alignItems:"center", gap:5 }}>
                        <span style={{ width:10, height:10, borderRadius:2, background:col, display:"inline-block" }} />{lbl}
                      </span>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={analyticsData} barCategoryGap="30%">
                      <XAxis dataKey="label" tick={{ fill:"rgba(255,255,255,0.4)", fontSize:11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill:"rgba(255,255,255,0.4)", fontSize:11 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background:"#302b63", border:"1px solid rgba(255,255,255,0.15)", borderRadius:10, color:"#fff", fontSize:13 }}
                        formatter={(val,name)=>[`${val} hrs`, name==="used"?"Time Used":name==="physical"?"Physical":"Time Wasted"]}
                        cursor={{ fill:"rgba(255,255,255,0.04)" }} />
                      <Bar dataKey="used"     fill="#1D9E75" radius={[4,4,0,0]} />
                      <Bar dataKey="physical" fill="#F97316" radius={[4,4,0,0]} />
                      <Bar dataKey="wasted"   fill="#D85A30" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {analyticsData.slice().reverse().map(d=>{
                    const tot = d.used+d.physical+d.wasted;
                    const pct = tot ? Math.round(((d.used+d.physical)/tot)*100) : 0;
                    return (
                      <div key={d.label} style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, padding:"12px 16px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                          <span style={{ fontSize:13, color:"rgba(255,255,255,0.7)", fontWeight:500 }}>{d.label}</span>
                          <span style={{ fontSize:12, color:pct>=60?"#5DCAA5":"#F0997B", fontWeight:600 }}>{pct}% productive</span>
                        </div>
                        <div style={{ height:5, borderRadius:99, background:"rgba(255,255,255,0.08)", overflow:"hidden", display:"flex", marginBottom:6 }}>
                          <div style={{ width:`${tot?Math.round((d.used/tot)*100):0}%`, background:"#1D9E75" }} />
                          <div style={{ width:`${tot?Math.round((d.physical/tot)*100):0}%`, background:"#F97316" }} />
                          <div style={{ width:`${tot?Math.round((d.wasted/tot)*100):0}%`, background:"#D85A30" }} />
                        </div>
                        <div style={{ display:"flex", gap:16, fontSize:11, color:"rgba(255,255,255,0.4)" }}>
                          <span>✅ {d.used}h used</span>
                          <span>🟠 {d.physical}h physical</span>
                          <span>❌ {d.wasted}h wasted</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
