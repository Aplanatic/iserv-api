import { useMemo, useState } from "react";
import { ROUTES, type RouteDefinition } from "../../src/Routes/RouteCatalog";

const token = new URLSearchParams(location.search).get("token");
const methodClass = (method: string) => `method method-${method.toLowerCase()}`;

export function App() {
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("all");
  const [selectedId, setSelectedId] = useState(ROUTES[0]?.id ?? "");
  const [response, setResponse] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => ROUTES.filter((route) => {
    const text = `${route.id} ${route.module} ${route.path} ${route.summary}`.toLowerCase();
    return (method === "all" || route.method === method) && text.includes(query.toLowerCase());
  }), [query, method]);
  const selected = ROUTES.find((route) => route.id === selectedId) ?? filtered[0];
  const modules = [...new Set(filtered.map((route) => route.module))];

  async function tryRoute(route: RouteDefinition) {
    if (!token) return;
    setBusy(true);
    setResponse(null);
    try {
      const result = await fetch("/api/try", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ routeId: route.id, parameters: {} }),
      });
      setResponse(await result.json());
    } catch (error) {
      setResponse({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Aplanatic / IServ API</p>
          <h1>Route explorer</h1>
        </div>
        <div className="stats"><strong>{filtered.length}</strong><span>routes</span></div>
      </header>
      <section className="toolbar" aria-label="Route filters">
        <label className="search"><span className="sr-only">Search routes</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search route, path, or module…" /></label>
        <label><span className="sr-only">HTTP method</span><select value={method} onChange={(event) => setMethod(event.target.value)}><option value="all">All methods</option>{[...new Set(ROUTES.map((route) => route.method))].map((item) => <option key={item}>{item}</option>)}</select></label>
      </section>
      <div className="panes">
        <nav className="tree" aria-label="API route tree">
          {modules.map((module) => <section key={module}><h2>{module}</h2>{filtered.filter((route) => route.module === module).map((route) => <button key={route.id} className={selected?.id === route.id ? "route active" : "route"} onClick={() => { setSelectedId(route.id); setResponse(null); }}><span className={methodClass(route.method)}>{route.method}</span><span>{route.id.split(".").slice(1).join(".")}</span></button>)}</section>)}
        </nav>
        <article className="details">
          {selected ? <>
            <div className="route-heading"><span className={methodClass(selected.method)}>{selected.method}</span><div><p className="route-id">{selected.id}</p><h2>{selected.summary}</h2></div></div>
            <code className="path">{selected.path}</code>
            <p className="description">{selected.description}</p>
            <dl className="metadata"><div><dt>Authentication</dt><dd>{selected.authentication}</dd></div><div><dt>Effect</dt><dd>{selected.sideEffect}</dd></div><div><dt>Status</dt><dd>{selected.status}</dd></div><div><dt>Source</dt><dd>{selected.provenance.kind}</dd></div></dl>
            <h3>Parameters</h3>
            {selected.parameters.length ? <table><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>{selected.parameters.map((parameter) => <tr key={`${parameter.location}-${parameter.name}`}><td><code>{parameter.name}</code></td><td>{parameter.location}</td><td>{parameter.required ? "Yes" : "No"}</td><td>{parameter.description}</td></tr>)}</tbody></table> : <p className="empty">No parameters.</p>}
          </> : <p className="empty">No routes match the current filters.</p>}
        </article>
        <aside className="preview">
          <div className="preview-heading"><div><p className="eyebrow">Local trial</p><h2>Redacted response</h2></div>{selected && <button disabled={!token || busy || selected.method !== "GET" || selected.sideEffect !== "read" || selected.parameters.some((parameter) => parameter.required)} onClick={() => tryRoute(selected)}>{busy ? "Running…" : "Try GET"}</button>}</div>
          {!token && <p className="notice">Launch through the authenticated local explorer server to try safe GET routes.</p>}
          <pre>{response ? JSON.stringify(response, null, 2) : "No request has been run."}</pre>
        </aside>
      </div>
    </main>
  );
}
