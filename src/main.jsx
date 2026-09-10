import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';

const STORAGE_KEY = 'callflow-v2';
const ROOT_ID = 'root';

const starterNode = () => ({
  id: ROOT_ID,
  type: 'conversation',
  position: { x: 80, y: 160 },
  data: {
    title: 'Introduction',
    question: 'Start the conversation here.',
    script: '',
    end: false,
    outcomes: [],
  },
});

function freshFlow() {
  return { nodes: [starterNode()], selectedId: ROOT_ID, history: [], viewport: { x: 0, y: 0, zoom: 1 } };
}

function normalizeFlow(raw) {
  if (!raw?.nodes?.length) return freshFlow();
  const nodes = raw.nodes.map((n, i) => ({
    id: n.id || `node-${i}`,
    type: 'conversation',
    position: n.position || { x: i * 80, y: i * 80 },
    data: {
      title: n.data?.title || 'Untitled node',
      question: n.data?.question || '',
      script: n.data?.script || '',
      end: Boolean(n.data?.end),
      outcomes: Array.isArray(n.data?.outcomes)
        ? n.data.outcomes.map((o, j) => ({ id: o.id || `outcome-${j}`, label: o.label || 'Response', targetId: o.targetId || null }))
        : [],
    },
  }));
  if (!nodes.some(n => n.id === ROOT_ID)) nodes.unshift(starterNode());
  return { nodes, selectedId: raw.selectedId || ROOT_ID, history: Array.isArray(raw.history) ? raw.history : [], viewport: raw.viewport || { x: 0, y: 0, zoom: 1 } };
}

function App() {
  const [flow, setFlow] = useState(() => {
    try { return normalizeFlow(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch { return freshFlow(); }
  });
  const [callMode, setCallMode] = useState(false);
  const [notice, setNotice] = useState('');
  const [fitNonce, setFitNonce] = useState(0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flow));
  }, [flow]);

  const nodesById = useMemo(() => Object.fromEntries(flow.nodes.map(n => [n.id, n])), [flow.nodes]);
  const currentId = flow.history.at(-1)?.nodeId || ROOT_ID;

  const updateNodes = useCallback((changes) => {
    setFlow(f => ({ ...f, nodes: applyNodeChanges(changes, f.nodes) }));
  }, []);

  const selectNode = useCallback((id) => {
    setFlow(f => ({ ...f, selectedId: id }));
  }, []);

  const addNode = useCallback((parentId = flow.selectedId, outcomeId = null, label = 'New response') => {
    const id = `node-${crypto.randomUUID()}`;
    const parent = nodesById[parentId];
    if (!parent) return;
    const outcomes = parent.data.outcomes || [];
    const existingOutcome = outcomes.find(o => o.id === outcomeId);
    const newOutcome = existingOutcome ? { ...existingOutcome, targetId: id } : { id: outcomeId || `outcome-${crypto.randomUUID()}`, label, targetId: id };
    const nextX = parent.position.x + 360;
    const nextY = parent.position.y + Math.max(0, outcomes.length - 1) * 150;
    const node = {
      id,
      type: 'conversation',
      position: { x: nextX, y: nextY },
      data: { title: 'New conversation step', question: '', script: '', end: false, outcomes: [] },
    };
    setFlow(f => ({ ...f, nodes: [...f.nodes.map(n => n.id === parentId ? { ...n, data: { ...n.data, outcomes: existingOutcome ? n.data.outcomes.map(o => o.id === outcomeId ? newOutcome : o) : [...(n.data.outcomes || []), newOutcome] } } : n), node], selectedId: id }));
  }, [flow.selectedId, nodesById]);

  const addOutcome = useCallback((nodeId) => {
    setFlow(f => ({
      ...f,
      nodes: f.nodes.map(n => n.id === nodeId ? {
        ...n,
        data: { ...n.data, outcomes: [...(n.data.outcomes || []), { id: `outcome-${crypto.randomUUID()}`, label: 'Maybe', targetId: null }] }
      } : n)
    }));
  }, []);

  const updateNodeData = useCallback((id, patch) => {
    setFlow(f => ({ ...f, nodes: f.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n) }));
  }, []);

  const updateOutcome = useCallback((nodeId, outcomeId, patch) => {
    setFlow(f => ({ ...f, nodes: f.nodes.map(n => n.id === nodeId ? {
      ...n,
      data: { ...n.data, outcomes: (n.data.outcomes || []).map(o => o.id === outcomeId ? { ...o, ...patch } : o) }
    } : n) }));
  }, []);

  const removeOutcome = useCallback((nodeId, outcomeId) => {
    setFlow(f => ({ ...f, nodes: f.nodes.map(n => n.id === nodeId ? { ...n, data: { ...n.data, outcomes: n.data.outcomes.filter(o => o.id !== outcomeId) } } : n) }));
  }, []);

  const deleteNode = useCallback((id) => {
    if (id === ROOT_ID) return setNotice('The Introduction node is the root and cannot be deleted.');
    const exists = flow.nodes.find(n => n.id === id);
    if (!exists) return;
    if (!window.confirm(`Delete “${exists.data.title || 'this node'}”? Its incoming branch will be disconnected.`)) return;
    setFlow(f => ({
      ...f,
      nodes: f.nodes.filter(n => n.id !== id).map(n => ({ ...n, data: { ...n.data, outcomes: (n.data.outcomes || []).map(o => o.targetId === id ? { ...o, targetId: null } : o) } })),
      selectedId: ROOT_ID,
      history: f.history.filter(h => h.nodeId !== id),
    }));
  }, [flow.nodes]);

  const duplicateNode = useCallback((id) => {
    const source = nodesById[id];
    if (!source) return;
    const newId = `node-${crypto.randomUUID()}`;
    const clone = { ...source, id: newId, position: { x: source.position.x + 60, y: source.position.y + 60 }, data: { ...source.data, title: `${source.data.title || 'Node'} Copy`, outcomes: [] } };
    setFlow(f => ({ ...f, nodes: [...f.nodes, clone], selectedId: newId }));
  }, [nodesById]);

  const resetFlow = useCallback(() => {
    if (!window.confirm('Reset CallFlow to one clean Introduction node? This removes your saved flow from this browser.')) return;
    const next = freshFlow();
    setFlow(next);
    setCallMode(false);
    setFitNonce(n => n + 1);
  }, []);

  const traverse = useCallback((nodeId, outcomeId) => {
    const node = nodesById[nodeId];
    const outcome = node?.data.outcomes?.find(o => o.id === outcomeId);
    if (!outcome?.targetId || !nodesById[outcome.targetId]) {
      setNotice(`“${outcome?.label || 'That response'}” has no destination yet.`);
      return;
    }
    setFlow(f => ({ ...f, selectedId: outcome.targetId, history: [...f.history, { nodeId: outcome.targetId, via: outcome.label, from: nodeId }] }));
  }, [nodesById]);

  const goBack = useCallback(() => {
    setFlow(f => {
      if (!f.history.length) return f;
      const history = f.history.slice(0, -1);
      return { ...f, history, selectedId: history.at(-1)?.nodeId || ROOT_ID };
    });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (!callMode || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === 'escape') { setCallMode(false); return; }
      if (key === 'backspace') { e.preventDefault(); goBack(); return; }
      const outcomes = nodesById[currentId]?.data.outcomes || [];
      const wanted = { y: 'yes', n: 'no', m: 'maybe' }[key];
      if (!wanted) return;
      const match = outcomes.find(o => o.label.trim().toLowerCase() === wanted) || outcomes.find(o => o.label.trim().toLowerCase().startsWith(wanted));
      if (match) traverse(currentId, match.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [callMode, nodesById, currentId, traverse, goBack]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">CF</div>
          <div><div className="brand-name">CallFlow</div><div className="brand-sub">Visual recruiter call-flow builder</div></div>
        </div>
        <div className="top-actions">
          <button className={`button ${callMode ? 'button-active' : ''}`} onClick={() => { setCallMode(v => { const next = !v; if (next) setFlow(f => ({ ...f, history: [], selectedId: ROOT_ID })); return next; }); }}>▶ {callMode ? 'Exit Call Mode' : 'Call Mode'}</button>
          <button className="button primary" onClick={() => addNode()}>＋ Add Node</button>
          <button className="button ghost" onClick={resetFlow}>Reset Demo</button>
        </div>
      </header>

      <main className="workspace">
        <section className="canvas-panel">
          <FlowCanvas
            nodes={flow.nodes}
            currentId={currentId}
            selectedId={flow.selectedId}
            history={flow.history}
            onNodesChange={updateNodes}
            onSelect={selectNode}
            onTraverse={traverse}
            fitNonce={fitNonce}
            traversalActive={callMode}
          />
          <div className="canvas-hint">Drag nodes to arrange · drag empty space to pan · scroll / pinch to zoom</div>
        </section>
        <aside className="editor-panel">
          {callMode ? (
            <CallPanel nodesById={nodesById} currentId={currentId} history={flow.history} onTraverse={traverse} onBack={goBack} onExit={() => setCallMode(false)} />
          ) : (
            <Editor
              node={nodesById[flow.selectedId] || nodesById[ROOT_ID]}
              nodes={flow.nodes}
              onChange={updateNodeData}
              onOutcome={updateOutcome}
              onAddOutcome={addOutcome}
              onRemoveOutcome={removeOutcome}
              onCreateChild={(nodeId, outcomeId, label) => addNode(nodeId, outcomeId, label)}
              onDuplicate={duplicateNode}
              onDelete={deleteNode}
            />
          )}
        </aside>
      </main>
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

function FlowCanvas({ nodes, currentId, selectedId, history, onNodesChange, onSelect, onTraverse, fitNonce, traversalActive }) {
  const { fitView } = useReactFlow();
  const nodeMap = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes]);
  const visited = useMemo(() => new Set([ROOT_ID, ...history.map(h => h.nodeId)]), [history]);
  const activeNext = useMemo(() => traversalActive ? new Set((nodeMap[currentId]?.data.outcomes || []).map(o => o.targetId).filter(Boolean)) : new Set(), [nodeMap, currentId, traversalActive]);
  const flowNodes = useMemo(() => nodes.map(n => ({
    ...n,
    data: { ...n.data, current: traversalActive && n.id === currentId, selected: n.id === selectedId, visited: traversalActive && visited.has(n.id), activeNext: traversalActive && activeNext.has(n.id) },
  })), [nodes, currentId, selectedId, visited, activeNext]);
  const edges = useMemo(() => nodes.flatMap(n => (n.data.outcomes || []).filter(o => o.targetId && nodeMap[o.targetId]).map(o => ({
    id: `${n.id}-${o.id}`,
    source: n.id,
    sourceHandle: `source-${o.id}`,
    target: o.targetId,
    targetHandle: 'target',
    type: 'smoothstep',
    animated: traversalActive && n.id === currentId && Boolean(o.targetId),
    label: o.label,
    markerEnd: { type: MarkerType.ArrowClosed },
    className: traversalActive && n.id === currentId ? 'flow-edge edge-active' : 'flow-edge',
    labelStyle: { fill: '#b9c1d0', fontSize: 11, fontWeight: 700 },
    labelBgStyle: { fill: '#11151e', fillOpacity: 0.96 },
  }))), [nodes, nodeMap, currentId]);

  useEffect(() => { if (fitNonce) setTimeout(() => fitView({ padding: 0.2, duration: 350 }), 0); }, [fitNonce, fitView]);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={edges}
      nodeTypes={{ conversation: ConversationNode }}
      onNodesChange={onNodesChange}
      onNodeClick={(_, node) => onSelect(node.id)}
      fitView
      minZoom={0.25}
      maxZoom={1.8}
      panOnScroll
      panOnDrag
      selectionOnDrag={false}
      zoomOnScroll={false}
      zoomOnPinch
      defaultEdgeOptions={{ type: 'smoothstep' }}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} color="#1c2330" />
      <Controls showInteractive={false} />
      <MiniMap nodeColor={(n) => n.id === currentId ? '#a8e6cf' : '#3a4353'} maskColor="rgba(7,9,13,.75)" />
    </ReactFlow>
  );
}

function ConversationNode({ id, data }) {
  return (
    <div className={`conversation-node ${data.current ? 'is-current' : ''} ${data.selected ? 'is-selected' : ''} ${data.visited ? 'is-visited' : ''} ${data.activeNext ? 'is-next' : ''} ${data.end ? 'is-end' : ''}`}>
      <Handle type="target" position={Position.Left} id="target" />
      <div className="node-kicker">{data.end ? 'END NODE' : id === ROOT_ID ? 'START NODE' : 'CONVERSATION STEP'}</div>
      <div className="node-title">{data.title || 'Untitled node'}</div>
      {data.question && <div className="node-question">{data.question}</div>}
      {data.script && <div className="node-script">“{data.script}”</div>}
      {(data.outcomes || []).map((outcome, i) => (
        <div className="node-outcome" key={outcome.id}>
          <span className="outcome-dot" />
          <span>{outcome.label || `Response ${i + 1}`}</span>
          <Handle type="source" position={Position.Right} id={`source-${outcome.id}`} className="outcome-handle" />
        </div>
      ))}
    </div>
  );
}

function Editor({ node, nodes, onChange, onOutcome, onAddOutcome, onRemoveOutcome, onCreateChild, onDuplicate, onDelete }) {
  const [draft, setDraft] = useState(node.data);
  useEffect(() => setDraft(node.data), [node.id, node.data]);
  if (!node) return null;
  const save = () => onChange(node.id, draft);
  const destinationOptions = nodes.filter(n => n.id !== node.id);

  return (
    <div className="editor-content">
      <div className="panel-eyebrow">NODE EDITOR</div>
      <h2>{node.data.title || 'Conversation node'}</h2>
      <p className="muted">Build the conversation yourself. A node can have any number of response branches — YES, NO, MAYBE, or your own label.</p>

      <label>NODE TITLE<input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Currently available?" /></label>
      <label>QUESTION / CONCLUSION<textarea rows="3" value={draft.question} onChange={e => setDraft(d => ({ ...d, question: e.target.value }))} placeholder="What are you asking or concluding?" /></label>
      <label>SCRIPT — WHAT I SAY<textarea rows="5" value={draft.script} onChange={e => setDraft(d => ({ ...d, script: e.target.value }))} placeholder="Exact words you want to say on the call..." /></label>

      <div className="section-heading"><span>RESPONSE BRANCHES</span><button className="tiny-button" onClick={() => onAddOutcome(node.id)}>＋ Add branch</button></div>
      <div className="outcome-editor-list">
        {(draft.outcomes || []).map((outcome) => (
          <div className="outcome-editor" key={outcome.id}>
            <div className="outcome-row">
              <input className="branch-label" value={outcome.label} onChange={e => { const next = draft.outcomes.map(o => o.id === outcome.id ? { ...o, label: e.target.value } : o); setDraft(d => ({ ...d, outcomes: next })); }} placeholder="YES / NO / MAYBE" />
              <button className="icon-button danger" onClick={() => { onRemoveOutcome(node.id, outcome.id); setDraft(d => ({ ...d, outcomes: d.outcomes.filter(o => o.id !== outcome.id) })); }}>×</button>
            </div>
            <select value={outcome.targetId || ''} onChange={e => { const next = draft.outcomes.map(o => o.id === outcome.id ? { ...o, targetId: e.target.value || null } : o); setDraft(d => ({ ...d, outcomes: next })); }}>
              <option value="">No destination yet</option>
              {destinationOptions.map(n => <option key={n.id} value={n.id}>{n.data.title || 'Untitled node'}</option>)}
            </select>
            <button className="subtle-button" onClick={() => onCreateChild(node.id, outcome.id, outcome.label || 'Response')}>＋ Create new child node</button>
          </div>
        ))}
        {!(draft.outcomes || []).length && <div className="empty-branches">No branches yet. Add one and label it anything you want.</div>}
      </div>

      <label className="toggle-row"><input type="checkbox" checked={Boolean(draft.end)} onChange={e => setDraft(d => ({ ...d, end: e.target.checked, outcomes: e.target.checked ? [] : d.outcomes }))} /> <span><strong>End of call node</strong><small>No response branches. This is where the conversation ends.</small></span></label>

      <div className="editor-actions">
        <button className="button primary wide" onClick={save}>Save Changes</button>
        <button className="button" onClick={() => onDuplicate(node.id)}>Duplicate</button>
      </div>
      <button className="delete-link" onClick={() => onDelete(node.id)} disabled={node.id === ROOT_ID}>Delete Node</button>
    </div>
  );
}

function CallPanel({ nodesById, currentId, history, onTraverse, onBack, onExit }) {
  const node = nodesById[currentId];
  const outcomes = node?.data.outcomes || [];
  return (
    <div className="call-panel">
      <div className="call-topline"><span className="live-dot" /> CALL IN PROGRESS <button onClick={onExit}>Esc</button></div>
      <div className="breadcrumbs">
        <span>Introduction</span>
        {history.map((h, i) => <React.Fragment key={`${h.nodeId}-${i}`}><b>›</b><span>{h.via}</span><b>›</b><span>{nodesById[h.nodeId]?.data.title}</span></React.Fragment>)}
      </div>
      <div className="call-card">
        <div className="panel-eyebrow">CURRENT STEP</div>
        <h1>{node?.data.title || 'Untitled node'}</h1>
        {node?.data.question && <p className="call-question">{node.data.question}</p>}
        <div className="say-box"><div className="panel-eyebrow">SAY THIS</div><p>{node?.data.script || 'No script written for this node yet.'}</p></div>
        {node?.data.end ? <div className="end-call-message">END OF CALL</div> : <div className="call-branches">{outcomes.map(o => <button key={o.id} className="call-choice" onClick={() => onTraverse(currentId, o.id)}>{o.label}<span>→</span></button>)}</div>}
      </div>
      <div className="call-footer"><button className="button" onClick={onBack} disabled={!history.length}>← Back</button><span>Y / N / M shortcuts work in Call Mode</span><button className="button ghost" onClick={onExit}>End Call</button></div>
    </div>
  );
}

function AppWithProvider() {
  return <ReactFlowProvider><App /></ReactFlowProvider>;
}

createRoot(document.getElementById('root')).render(<AppWithProvider />);
