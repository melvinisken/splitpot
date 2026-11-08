(function () {
  "use strict";

  var useState = React.useState;
  var useEffect = React.useEffect;
  var useRef = React.useRef;

  var KEY = "split-pot-expenses-v1";
  var apiEndpoint = "/api/data";
  var SAVE_DEBOUNCE_MS = 500;

  function fetchApiGet() {
    return fetch(apiEndpoint).then(function (r) {
      if ((r.status === 404 || r.status === 405) && apiEndpoint !== "/api.php") {
        apiEndpoint = "/api.php";
        return fetch(apiEndpoint).then(function (r2) {
          if (!r2.ok) throw new Error("HTTP " + r2.status);
          return r2.json();
        });
      }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  var seed = {
    title: "Wochenende an der Küste",
    currency: "EUR",
    members: ["Alex", "Sam", "Mia", "Jonas"],
    expenses: [
      { id: 1, title: "Ferienwohnung", amount: 360, payer: "Alex", participants: ["Alex", "Sam", "Mia", "Jonas"], comment: "Anzahlung für beide Nächte", date: "2026-06-14" },
      { id: 2, title: "Einkauf & Frühstück", amount: 48.6, payer: "Sam", participants: ["Alex", "Sam", "Mia", "Jonas"], comment: "Supermarkt am Samstag", date: "2026-06-15" },
      { id: 3, title: "Abendessen", amount: 92, payer: "Mia", participants: ["Alex", "Mia", "Jonas"], comment: "Sam war schon abgereist", date: "2026-06-15" }
    ],
    payments: []
  };

  function readCache() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function fmt(n, c) {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: c || "EUR" }).format(n);
  }

  function dateFmt(s) {
    var d = new Date(String(s || "") + "T12:00:00");
    if (isNaN(d.getTime())) return String(s || "");
    return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short" }).format(d);
  }

  function balances(data) {
    var b = Object.fromEntries(data.members.map(function (m) { return [m, 0]; }));
    for (var i = 0; i < data.expenses.length; i++) {
      var e = data.expenses[i];
      var cents = Math.round(e.amount * 100), ps = e.participants || [];
      if (!ps.length) continue;
      var base = Math.floor(cents / ps.length), rem = cents - base * ps.length;
      ps.forEach(function (p, idx) {
        b[p] = (b[p] || 0) - (base + (idx < rem ? 1 : 0)) / 100;
      });
      b[e.payer] = (b[e.payer] || 0) + cents / 100;
    }
    for (var j = 0; j < (data.payments || []).length; j++) {
      var p = data.payments[j];
      b[p.from] = (b[p.from] || 0) + p.amount;
      b[p.to] = (b[p.to] || 0) - p.amount;
    }
    return b;
  }

  function settlements(b) {
    var debt = Object.entries(b).filter(function (x) { return x[1] < -4e-3; })
      .map(function (x) { return { name: x[0], amt: -x[1] }; })
      .sort(function (a, c) { return c.amt - a.amt; });
    var credit = Object.entries(b).filter(function (x) { return x[1] > 4e-3; })
      .map(function (x) { return { name: x[0], amt: x[1] }; })
      .sort(function (a, c) { return c.amt - a.amt; });
    var out = [], i = 0, j = 0;
    while (i < debt.length && j < credit.length) {
      var n = Math.min(debt[i].amt, credit[j].amt);
      out.push({ from: debt[i].name, to: credit[j].name, amount: Math.round(n * 100) / 100 });
      debt[i].amt -= n;
      credit[j].amt -= n;
      if (debt[i].amt < 5e-3) i++;
      if (credit[j].amt < 5e-3) j++;
    }
    return out;
  }

  function validData(d) {
    if (!d || typeof d.title !== "string" || !Array.isArray(d.members) ||
        !d.members.every(function (m) { return typeof m === "string" && m.trim(); }) ||
        !Array.isArray(d.expenses)) return false;
    if (!d.expenses.every(function (x) {
      return x && typeof x.title === "string" && Number.isFinite(Number(x.amount)) &&
        typeof x.payer === "string" && Array.isArray(x.participants) &&
        x.participants.length > 0 &&
        x.participants.every(function (p) { return typeof p === "string"; });
    })) return false;
    if (d.payments !== undefined) {
      if (!Array.isArray(d.payments) || !d.payments.every(function (p) {
        return p && typeof p.from === "string" && typeof p.to === "string" &&
          Number.isFinite(Number(p.amount));
      })) return false;
    }
    return true;
  }

  function saveStateLabel(state) {
    switch (state) {
      case "saving": return "Speichert…";
      case "saved": return "Gespeichert";
      case "error": return "Server nicht erreichbar – nur lokal gespeichert";
      case "offline": return "Offline – nur lokal gespeichert";
      default: return "";
    }
  }

  function App() {
    var dataState = useState(null);
    var data = dataState[0], setData = dataState[1];
    var modalState = useState("");
    var modal = modalState[0], setModal = modalState[1];
    var toastState = useState("");
    var toast = toastState[0], setToast = toastState[1];
    var draftState = useState(null);
    var draft = draftState[0], setDraft = draftState[1];
    var newNameState = useState("");
    var newName = newNameState[0], setNewName = newNameState[1];
    var saveStateSet = useState("idle");
    var saveState = saveStateSet[0], setSaveState = saveStateSet[1];
    var loadedRef = useRef(false);
    var timerRef = useRef(null);

    useEffect(function () {
      var cancelled = false;
      fetchApiGet().then(function (res) {
        if (cancelled) return;
        loadedRef.current = true;
        if (res && validData(res.data)) {
          setData(res.data);
        } else {
          var cached = readCache();
          setData(validData(cached) ? cached : seed);
        }
      }).catch(function () {
        if (cancelled) return;
        loadedRef.current = true;
        var cached = readCache();
        setData(validData(cached) ? cached : seed);
        setSaveState("offline");
      });
      return function () { cancelled = true; };
    }, []);

    useEffect(function () {
      if (!loadedRef.current || !data) return;
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* Speicher voll/gesperrt */ }
      setSaveState("saving");
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(function () {
        fetch(apiEndpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        }).then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          setSaveState("saved");
        }).catch(function () {
          setSaveState("error");
        });
      }, SAVE_DEBOUNCE_MS);
    }, [data]);

    function flash(t) {
      setToast(t);
      setTimeout(function () { setToast(""); }, 2300);
    }

    var bal = data ? balances(data) : null;
    var transfers = bal ? settlements(bal) : [];
    var total = data ? data.expenses.reduce(function (s, e) { return s + e.amount; }, 0) : 0;

    function openExpense(e) {
      setDraft(e
        ? { ...e, participants: [...e.participants] }
        : {
            id: Date.now(), title: "", amount: "", payer: data.members[0] || "",
            participants: [...data.members], comment: "",
            date: new Date().toISOString().slice(0, 10)
          });
      setModal("expense");
    }

    function saveExpense() {
      var a = Number(String(draft.amount).replace(",", "."));
      if (!draft.title.trim() || !Number.isFinite(a) || a <= 0 || !draft.payer || !draft.participants.length) {
        flash("Bitte Titel, gültigen Betrag, zahlende Person und mindestens eine teilnehmende Person angeben.");
        return;
      }
      var clean = { ...draft, title: draft.title.trim(), amount: Math.round(a * 100) / 100 };
      setData(function (d) {
        return {
          ...d,
          expenses: d.expenses.some(function (x) { return x.id === clean.id; })
            ? d.expenses.map(function (x) { return x.id === clean.id ? clean : x; })
            : [clean, ...d.expenses]
        };
      });
      setModal("");
      flash("Ausgabe gespeichert.");
    }

    function addMember() {
      var n = newName.trim();
      if (!n) return;
      if (data.members.some(function (m) { return m.toLowerCase() === n.toLowerCase(); })) {
        flash("Dieser Name ist bereits vorhanden.");
        return;
      }
      setData(function (d) { return { ...d, members: [...d.members, n] }; });
      setNewName("");
    }

    function removeExpense(id) {
      if (!confirm("Diese Ausgabe löschen?")) return;
      setData(function (d) { return { ...d, expenses: d.expenses.filter(function (e) { return e.id !== id; }) }; });
      setModal("");
      flash("Ausgabe gelöscht.");
    }

    function markPaid(t) {
      setData(function (d) {
        return { ...d, payments: [...(d.payments || []), { id: Date.now(), from: t.from, to: t.to, amount: t.amount }] };
      });
      flash("Ausgleich als bezahlt verbucht.");
    }

    function esc(s) {
      var v = String(s == null ? "" : s);
      if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
      return '"' + v.replaceAll('"', '""') + '"';
    }

    function exportCSV() {
      var rows = [["Datum", "Ausgabe", "Betrag", "Bezahlt von", "Dabei", "Kommentar"]]
        .concat(data.expenses.map(function (e) {
          return [e.date, e.title, e.amount, e.payer, e.participants.join(", "), e.comment];
        }));
      var csv = "\uFEFF" + rows.map(function (r) { return r.map(esc).join(";"); }).join("\r\n");
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = "gemeinsame-ausgaben.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    }

    function exportJSON() {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      a.download = "split-pot-daten.json";
      a.click();
      URL.revokeObjectURL(a.href);
      flash("JSON-Sicherung heruntergeladen.");
    }

    function importJSON(e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(reader.result);
          if (!validData(parsed)) throw new Error("Ungültiges Format");
          if (!confirm("Import ersetzt die derzeitigen Daten auf dem Server und in diesem Browser. Fortfahren?")) return;
          setData({ ...parsed, payments: Array.isArray(parsed.payments) ? parsed.payments : [] });
          flash("JSON-Daten importiert.");
        } catch (err) {
          flash("Datei ist kein gültiger Split Pot JSON-Export.");
        } finally {
          e.target.value = "";
        }
      };
      reader.readAsText(file);
    }

    if (!data) {
      return React.createElement("main", { className: "wrap" },
        React.createElement("div", { className: "empty", style: { padding: "60px 0" } }, "Lade…"));
    }

    var h = React.createElement;

    return h(React.Fragment, null,
      h("header", { className: "top" },
        h("div", { className: "logo" }, "↗"),
        h("div", { className: "brand" }, "Split Pot"),
        h("div", { className: "tagline" }, "Ausgaben fair teilen"),
        h("div", { className: "save-state " + (saveState === "saving" ? "saving" : saveState === "error" || saveState === "offline" ? "error" : ""), style: { marginLeft: "auto" } }, saveStateLabel(saveState))),
      h("main", { className: "wrap" },
        h("div", { className: "head" },
          h("div", null,
            h("div", { className: "eyebrow" }, "Dein Anlass"),
            h("h1", { className: "title" }, data.title),
            h("div", { className: "sub" }, data.members.length, " Personen · ", data.expenses.length, " ", data.expenses.length === 1 ? "Ausgabe" : "Ausgaben")),
          h("div", { className: "actions" },
            h("button", { className: "btn", onClick: function () { setModal("event"); } }, "⚙ Anlass"),
            h("button", { className: "btn", onClick: exportCSV }, "↓ CSV"),
            h("button", { className: "btn", onClick: exportJSON }, "JSON sichern"),
            h("button", { className: "btn", onClick: function () { document.getElementById("split-pot-import").click(); } }, "JSON laden"),
            h("input", { id: "split-pot-import", type: "file", accept: ".json,application/json", onChange: importJSON, style: { display: "none" } }),
            h("button", { className: "btn primary", onClick: function () { openExpense(); } }, "＋ Ausgabe"))),
        h("div", { className: "grid" },
          h("section", { className: "panel" },
            h("div", { className: "panel-head" },
              h("div", { className: "panel-title" }, "Ausgaben"),
              h("div", { className: "count" }, "Gesamt ", fmt(total, data.currency))),
            data.expenses.length === 0
              ? h("div", { className: "empty" }, "Noch keine Ausgaben. Lege den ersten Eintrag an.")
              : data.expenses.map(function (e) {
                  return h("div", { className: "expense", key: e.id },
                    h("div", { className: "ico" }, "↗"),
                    h("div", null,
                      h("div", { className: "ename" }, e.title),
                      h("div", { className: "detail" }, dateFmt(e.date), " · bezahlt von ", e.payer, e.comment ? " · " + e.comment : ""),
                      h("div", { className: "chips" }, (e.participants || []).map(function (p) {
                        return h("span", { className: "chip", key: p }, p);
                      }))),
                    h("div", null,
                      h("div", { className: "money" }, fmt(e.amount, data.currency)),
                      h("div", { className: "muted" }, (e.participants || []).length ? fmt(e.amount / e.participants.length, data.currency) + " p. P." : "–"),
                      h("button", { className: "btn small", style: { marginTop: 7 }, onClick: function () { openExpense(e); } }, "Bearbeiten")));
                })),
          h("aside", { className: "sidebar" },
            h("section", { className: "panel summary" },
              h("div", { className: "balance-label" }, "Gesamtausgaben"),
              h("div", { className: "balance-total" }, fmt(total, data.currency)),
              data.members.map(function (m) {
                return h("div", { className: "line", key: m },
                  h("span", null, m),
                  h("span", { className: bal[m] >= 0 ? "positive" : "negative" }, bal[m] > 4e-3 ? "+ " : "", fmt(bal[m], data.currency)));
              })),
            h("section", { className: "panel settle" },
              h("div", { className: "panel-head", style: { padding: "0 0 13px", border: 0 } },
                h("div", { className: "panel-title" }, "Ausgleich"),
                h("span", { className: "count" }, "wenige Überweisungen")),
              transfers.length
                ? transfers.map(function (t, i) {
                    return h("div", { className: "settle-row", key: i },
                      h("span", null, h("b", null, t.from), " zahlt an ", h("b", null, t.to)),
                      h("span", { style: { whiteSpace: "nowrap" } },
                        h("b", null, fmt(t.amount, data.currency)), " ",
                        h("button", { className: "btn small", onClick: function () { markPaid(t); } }, "Bezahlt")));
                  })
                : h("div", { className: "empty", style: { padding: "17px 4px" } }, "Alles ausgeglichen."),
              h("div", { className: "tip" }, "Salden basieren auf den Zahlenden und den ausgewählten Teilnehmenden. Ausgleiche kannst du als bezahlt verbuchen.")),
            h("section", { className: "panel", style: { padding: 18 } },
              h("div", { className: "panel-title", style: { marginBottom: 12 } }, "Personen"),
              h("div", { className: "name-list" }, data.members.map(function (m) {
                return h("span", { className: "member", key: m }, m);
              })),
              h("button", { className: "btn small", style: { marginTop: 13 }, onClick: function () { setModal("event"); } }, "Personen verwalten"))))),
        modal === "expense" && h("div", { className: "overlay", onMouseDown: function (e) {
          if (e.target === e.currentTarget) setModal("");
        } },
          h("div", { className: "modal" },
            h("div", { style: { display: "flex", justifyContent: "space-between" } },
              h("h2", null, data.expenses.some(function (e) { return e.id === draft.id; }) ? "Ausgabe bearbeiten" : "Neue Ausgabe"),
              h("button", { className: "close", onClick: function () { setModal(""); } }, "×")),
            h("div", { className: "row" },
              h("div", { className: "field" },
                h("label", null, "Beschreibung"),
                h("input", { autoFocus: true, placeholder: "z. B. Abendessen", value: draft.title, onChange: function (e) { setDraft({ ...draft, title: e.target.value }); } })),
              h("div", { className: "field" },
                h("label", null, "Betrag (", data.currency, ")"),
                h("input", { type: "number", min: "0.01", step: "0.01", placeholder: "0,00", value: draft.amount, onChange: function (e) { setDraft({ ...draft, amount: e.target.value }); } }))),
            h("div", { className: "row" },
              h("div", { className: "field" },
                h("label", null, "Bezahlt von"),
                h("select", { value: draft.payer, onChange: function (e) { setDraft({ ...draft, payer: e.target.value }); } },
                  data.members.map(function (m) { return h("option", { key: m }, m); }))),
              h("div", { className: "field" },
                h("label", null, "Datum"),
                h("input", { type: "date", value: draft.date, onChange: function (e) { setDraft({ ...draft, date: e.target.value }); } }))),
            h("div", { className: "field" },
              h("label", null, "Wer war dabei? · anklicken"),
              h("div", { className: "people" }, data.members.map(function (m) {
                return h("button", { type: "button", key: m, className: "person " + (draft.participants.includes(m) ? "on" : ""), onClick: function () {
                  setDraft({ ...draft, participants: draft.participants.includes(m) ? draft.participants.filter(function (x) { return x !== m; }) : [...draft.participants, m] });
                } }, draft.participants.includes(m) ? "✓ " : "", m);
              }))),
            h("div", { className: "field" },
              h("label", null, "Kommentar (optional)"),
              h("input", { placeholder: "Weitere Details zur Ausgabe", value: draft.comment, onChange: function (e) { setDraft({ ...draft, comment: e.target.value }); } })),
            h("div", { className: "notice" }, "Gleichmäßige Aufteilung auf die ausgewählten Personen."),
            h("div", { className: "modal-foot" },
              h("div", null, data.expenses.some(function (e) { return e.id === draft.id; }) &&
                h("button", { className: "btn", onClick: function () { removeExpense(draft.id); } }, "Löschen")),
              h("div", { className: "left-buttons" },
                h("button", { className: "btn", onClick: function () { setModal(""); } }, "Abbrechen"),
                h("button", { className: "btn primary", onClick: saveExpense }, "Speichern"))))),
        modal === "event" && h("div", { className: "overlay", onMouseDown: function (e) {
          if (e.target === e.currentTarget) setModal("");
        } },
          h("div", { className: "modal" },
            h("div", { style: { display: "flex", justifyContent: "space-between" } },
              h("h2", null, "Anlass & Personen"),
              h("button", { className: "close", onClick: function () { setModal(""); } }, "×")),
            h("div", { className: "field" },
              h("label", null, "Name des Anlasses"),
              h("input", { value: data.title, onChange: function (e) { setData({ ...data, title: e.target.value }); } })),
            h("div", { className: "field" },
              h("label", null, "Währung"),
              h("select", { value: data.currency, onChange: function (e) { setData({ ...data, currency: e.target.value }); } },
                ["EUR", "CHF", "USD", "GBP", "DKK", "SEK", "NOK"].map(function (c) { return h("option", { key: c }, c); }))),
            h("div", { className: "field" },
              h("label", null, "Teilnehmende"),
              h("div", { className: "name-list" }, data.members.map(function (m) {
                return h("span", { className: "member", key: m }, m,
                  !data.expenses.some(function (e) { return e.payer === m || (e.participants || []).includes(m); }) &&
                  h("button", { title: "Entfernen", onClick: function () {
                    setData(function (d) { return { ...d, members: d.members.filter(function (x) { return x !== m; }) }; });
                  } }, "×"));
              }))),
            h("form", { onSubmit: function (e) {
              e.preventDefault();
              addMember();
            }, style: { display: "flex", gap: 8 } },
              h("input", { placeholder: "Name hinzufügen…", value: newName, onChange: function (e) { setNewName(e.target.value); }, style: { flex: 1, border: "1px solid #dfe4dc", borderRadius: 9, padding: "10px 12px" } }),
              h("button", { className: "btn", type: "submit" }, "＋ Hinzufügen")),
            h("div", { className: "notice", style: { marginTop: 13 } },
              "Personen mit Ausgaben in der Historie können nicht entfernt werden. Die Daten werden auf dem Server gespeichert ",
              "(Datei data/splitpot.json); zusätzlich bleibt eine lokale Kopie im Browser. Über „JSON sichern“ kannst du jederzeit eine Exportdatei erzeugen."),
            h("div", { className: "modal-foot", style: { justifyContent: "flex-end" } },
              h("button", { className: "btn primary", onClick: function () { setModal(""); } }, "Fertig")))),
        toast && h("div", { className: "toast" }, toast));
  }

  window.addEventListener("error", function (e) {
    var el = document.getElementById("root");
    if (!el) return;
    el.replaceChildren();
    var pre = document.createElement("pre");
    pre.style.cssText = "color:#b91c1c;padding:16px;white-space:pre-wrap;font:12px ui-monospace,monospace";
    pre.textContent = "Preview error: " + String(e.message || e.error);
    el.appendChild(pre);
  });

  ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
})();
