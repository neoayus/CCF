import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

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
  useReactFlow,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import "./styles.css";

import defaultFlow from "./data/defaultFlow.json";

const STORAGE_KEY = "callflow-v2";
const ROOT_ID = "root";

/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */

function createId(prefix = "id") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/* -------------------------------------------------------
   Starter flow
------------------------------------------------------- */

function starterNode() {
  return {
    id: ROOT_ID,
    type: "conversation",
    position: {
      x: 80,
      y: 160,
    },
    data: {
      title: "Introduction",
      question: "Start the conversation here.",
      script: "",
      end: false,
      outcomes: [],
    },
  };
}

function freshFlow() {
  return {
    nodes: [starterNode()],
    selectedId: ROOT_ID,
    history: [],
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
    },
  };
}

/* -------------------------------------------------------
   Normalize imported / saved flows
------------------------------------------------------- */

function normalizeFlow(raw) {
  if (!raw || !Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    return freshFlow();
  }

  const nodes = raw.nodes.map((node, index) => ({
    id: node.id || createId(`node-${index}`),
    type: "conversation",

    position: node.position || {
      x: index * 360,
      y: index * 160,
    },

    data: {
      title: node.data?.title || "Untitled node",
      question: node.data?.question || "",
      script: node.data?.script || "",
      end: Boolean(node.data?.end),

      outcomes: Array.isArray(node.data?.outcomes)
        ? node.data.outcomes.map((outcome, outcomeIndex) => ({
            id:
              outcome.id ||
              createId(`outcome-${outcomeIndex}`),

            label:
              typeof outcome.label === "string"
                ? outcome.label
                : "Response",

            targetId:
              typeof outcome.targetId === "string"
                ? outcome.targetId
                : null,
          }))
        : [],
    },
  }));

  // Make sure a root node always exists.
  if (!nodes.some((node) => node.id === ROOT_ID)) {
    nodes.unshift(starterNode());
  }

  const selectedId =
    nodes.some((node) => node.id === raw.selectedId)
      ? raw.selectedId
      : ROOT_ID;

  const validNodeIds = new Set(nodes.map((node) => node.id));

  const history = Array.isArray(raw.history)
    ? raw.history.filter((item) =>
        validNodeIds.has(item.nodeId)
      )
    : [];

  return {
    nodes,
    selectedId,
    history,

    viewport: {
      x: Number(raw.viewport?.x) || 0,
      y: Number(raw.viewport?.y) || 0,
      zoom:
        Number(raw.viewport?.zoom) > 0
          ? Number(raw.viewport.zoom)
          : 1,
    },
  };
}

/* -------------------------------------------------------
   Default flow
------------------------------------------------------- */

function getDefaultFlow() {
  /*
   Your defaultFlow.json may be either:

   {
     nodes: [...]
   }

   or

   [...]
  */

  if (Array.isArray(defaultFlow)) {
    return normalizeFlow({
      nodes: defaultFlow,
    });
  }

  return normalizeFlow({
    ...clone(defaultFlow),

    // Never restore an old editing session as the default.
    selectedId: ROOT_ID,
    history: [],
  });
}

/* -------------------------------------------------------
   App
------------------------------------------------------- */

function App() {
  const [flow, setFlow] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);

      if (saved) {
        return normalizeFlow(JSON.parse(saved));
      }
    } catch (error) {
      console.error(
        "Could not load saved CallFlow:",
        error
      );
    }

    // First visit = YOUR defaultFlow.json
    return getDefaultFlow();
  });

  const [callMode, setCallMode] = useState(false);
  const [notice, setNotice] = useState("");
  const [fitNonce, setFitNonce] = useState(0);

  /* -----------------------------------------------------
     Persist automatically
  ----------------------------------------------------- */

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(flow)
      );
    } catch (error) {
      console.error(
        "Could not save CallFlow:",
        error
      );
    }
  }, [flow]);

  /* -----------------------------------------------------
     Node lookup
  ----------------------------------------------------- */

  const nodesById = useMemo(
    () =>
      Object.fromEntries(
        flow.nodes.map((node) => [node.id, node])
      ),
    [flow.nodes]
  );

  /*
   * When Call Mode is inactive, selectedId determines
   * what you're editing.

   * When Call Mode is active, history determines the
   * current conversation step.
   */
  const currentId =
    flow.history.length > 0
      ? flow.history[flow.history.length - 1].nodeId
      : ROOT_ID;

  /* -----------------------------------------------------
     Node changes
  ----------------------------------------------------- */

  const updateNodes = useCallback((changes) => {
    setFlow((previous) => ({
      ...previous,
      nodes: applyNodeChanges(
        changes,
        previous.nodes
      ),
    }));
  }, []);

  /* -----------------------------------------------------
     Select node
  ----------------------------------------------------- */

  const selectNode = useCallback((id) => {
    setFlow((previous) => ({
      ...previous,
      selectedId: id,
    }));
  }, []);

  /* -----------------------------------------------------
     Add node
  ----------------------------------------------------- */

  const addNode = useCallback(
    (
      parentId = flow.selectedId || ROOT_ID,
      outcomeId = null,
      label = "New response"
    ) => {
      setFlow((previous) => {
        const parent = previous.nodes.find(
          (node) => node.id === parentId
        );

        if (!parent) {
          return previous;
        }

        const newNodeId = createId("node");

        const outcomes = parent.data.outcomes || [];

        const existingOutcome = outcomeId
          ? outcomes.find(
              (outcome) => outcome.id === outcomeId
            )
          : null;

        const newOutcome = existingOutcome
          ? {
              ...existingOutcome,
              targetId: newNodeId,
            }
          : {
              id: createId("outcome"),
              label: label || "New response",
              targetId: newNodeId,
            };

        const nextOutcomeIndex =
          existingOutcome
            ? outcomes.findIndex(
                (outcome) =>
                  outcome.id === outcomeId
              )
            : outcomes.length;

        const newNode = {
          id: newNodeId,
          type: "conversation",

          position: {
            x: parent.position.x + 380,
            y:
              parent.position.y +
              nextOutcomeIndex * 180,
          },

          data: {
            title: "New conversation step",
            question: "",
            script: "",
            end: false,
            outcomes: [],
          },
        };

        const updatedNodes = previous.nodes.map(
          (node) => {
            if (node.id !== parentId) {
              return node;
            }

            return {
              ...node,

              data: {
                ...node.data,

                outcomes: existingOutcome
                  ? outcomes.map((outcome) =>
                      outcome.id === outcomeId
                        ? newOutcome
                        : outcome
                    )
                  : [...outcomes, newOutcome],
              },
            };
          }
        );

        return {
          ...previous,
          nodes: [
            ...updatedNodes,
            newNode,
          ],
          selectedId: newNodeId,
        };
      });
    },
    [flow.selectedId]
  );

  /* -----------------------------------------------------
     Add branch
  ----------------------------------------------------- */

  const addOutcome = useCallback((nodeId) => {
    setFlow((previous) => ({
      ...previous,

      nodes: previous.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        return {
          ...node,

          data: {
            ...node.data,

            outcomes: [
              ...(node.data.outcomes || []),

              {
                id: createId("outcome"),
                label: "Maybe",
                targetId: null,
              },
            ],
          },
        };
      }),
    }));
  }, []);

  /* -----------------------------------------------------
     Update node data
  ----------------------------------------------------- */

  const updateNodeData = useCallback(
    (id, patch) => {
      setFlow((previous) => ({
        ...previous,

        nodes: previous.nodes.map((node) =>
          node.id === id
            ? {
                ...node,

                data: {
                  ...node.data,
                  ...patch,
                },
              }
            : node
        ),
      }));
    },
    []
  );

  /* -----------------------------------------------------
     Update branch
  ----------------------------------------------------- */

  const updateOutcome = useCallback(
    (nodeId, outcomeId, patch) => {
      setFlow((previous) => ({
        ...previous,

        nodes: previous.nodes.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }

          return {
            ...node,

            data: {
              ...node.data,

              outcomes: (
                node.data.outcomes || []
              ).map((outcome) =>
                outcome.id === outcomeId
                  ? {
                      ...outcome,
                      ...patch,
                    }
                  : outcome
              ),
            },
          };
        }),
      }));
    },
    []
  );

  /* -----------------------------------------------------
     Remove branch
  ----------------------------------------------------- */

  const removeOutcome = useCallback(
    (nodeId, outcomeId) => {
      setFlow((previous) => ({
        ...previous,

        nodes: previous.nodes.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }

          return {
            ...node,

            data: {
              ...node.data,

              outcomes: (
                node.data.outcomes || []
              ).filter(
                (outcome) =>
                  outcome.id !== outcomeId
              ),
            },
          };
        }),
      }));
    },
    []
  );

  /* -----------------------------------------------------
     Delete node
  ----------------------------------------------------- */

  const deleteNode = useCallback(
    (id) => {
      if (id === ROOT_ID) {
        setNotice(
          "The Introduction node is the root and cannot be deleted."
        );

        return;
      }

      const existingNode = flow.nodes.find(
        (node) => node.id === id
      );

      if (!existingNode) {
        return;
      }

      const confirmed = window.confirm(
        `Delete "${
          existingNode.data.title ||
          "this node"
        }"? Its incoming branches will be disconnected.`
      );

      if (!confirmed) {
        return;
      }

      setFlow((previous) => {
        const remainingNodes =
          previous.nodes
            .filter(
              (node) => node.id !== id
            )
            .map((node) => ({
              ...node,

              data: {
                ...node.data,

                outcomes: (
                  node.data.outcomes || []
                ).map((outcome) =>
                  outcome.targetId === id
                    ? {
                        ...outcome,
                        targetId: null,
                      }
                    : outcome
                ),
              },
            }));

        return {
          ...previous,

          nodes: remainingNodes,

          selectedId: ROOT_ID,

          history:
            previous.history.filter(
              (item) =>
                item.nodeId !== id
            ),
        };
      });
    },
    [flow.nodes]
  );

  /* -----------------------------------------------------
     Duplicate node
  ----------------------------------------------------- */

  const duplicateNode = useCallback(
    (id) => {
      const source = nodesById[id];

      if (!source) {
        return;
      }

      const newId = createId("node");

      const cloneNode = {
        ...source,

        id: newId,

        position: {
          x: source.position.x + 80,
          y: source.position.y + 80,
        },

        data: {
          ...source.data,

          title: `${
            source.data.title ||
            "Node"
          } Copy`,

          outcomes: [],
        },
      };

      setFlow((previous) => ({
        ...previous,

        nodes: [
          ...previous.nodes,
          cloneNode,
        ],

        selectedId: newId,
      }));
    },
    [nodesById]
  );

  /* -----------------------------------------------------
     Reset to DEFAULT JSON
  ----------------------------------------------------- */

  const resetFlow = useCallback(() => {
    const confirmed = window.confirm(
      "Reset CallFlow to your default call flow? Your saved browser version will be replaced."
    );

    if (!confirmed) {
      return;
    }

    const next = getDefaultFlow();

    setFlow(next);
    setCallMode(false);
    setFitNonce((value) => value + 1);
  }, []);

  /* -----------------------------------------------------
     Traverse conversation
  ----------------------------------------------------- */

  const traverse = useCallback(
    (nodeId, outcomeId) => {
      const node = nodesById[nodeId];

      if (!node) {
        return;
      }

      const outcome =
        node.data.outcomes?.find(
          (item) =>
            item.id === outcomeId
        );

      if (!outcome) {
        return;
      }

      if (
        !outcome.targetId ||
        !nodesById[outcome.targetId]
      ) {
        setNotice(
          `"${outcome.label || "That response"}" has no destination yet.`
        );

        return;
      }

      setFlow((previous) => ({
        ...previous,

        selectedId: outcome.targetId,

        history: [
          ...previous.history,

          {
            nodeId: outcome.targetId,
            via: outcome.label,
            from: nodeId,
          },
        ],
      }));
    },
    [nodesById]
  );

  /* -----------------------------------------------------
     Back
  ----------------------------------------------------- */

  const goBack = useCallback(() => {
    setFlow((previous) => {
      if (!previous.history.length) {
        return previous;
      }

      const history =
        previous.history.slice(0, -1);

      return {
        ...previous,

        history,

        selectedId:
          history.length > 0
            ? history[history.length - 1]
                .nodeId
            : ROOT_ID,
      };
    });
  }, []);

  /* -----------------------------------------------------
     Keyboard shortcuts
  ----------------------------------------------------- */

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!callMode) {
        return;
      }

      const activeElement =
        document.activeElement;

      const isTyping =
        activeElement &&
        [
          "INPUT",
          "TEXTAREA",
          "SELECT",
        ].includes(
          activeElement.tagName
        );

      if (isTyping) {
        return;
      }

      const key =
        event.key.toLowerCase();

      if (key === "escape") {
        setCallMode(false);
        return;
      }

      if (key === "backspace") {
        event.preventDefault();
        goBack();
        return;
      }

      const shortcutMap = {
        y: "yes",
        n: "no",
        m: "maybe",
      };

      const wanted =
        shortcutMap[key];

      if (!wanted) {
        return;
      }

      const outcomes =
        nodesById[currentId]?.data
          ?.outcomes || [];

      const match =
        outcomes.find(
          (outcome) =>
            outcome.label
              ?.trim()
              .toLowerCase() === wanted
        ) ||
        outcomes.find(
          (outcome) =>
            outcome.label
              ?.trim()
              .toLowerCase()
              .startsWith(wanted)
        );

      if (match) {
        traverse(
          currentId,
          match.id
        );
      }
    };

    window.addEventListener(
      "keydown",
      onKeyDown
    );

    return () =>
      window.removeEventListener(
        "keydown",
        onKeyDown
      );
  }, [
    callMode,
    currentId,
    nodesById,
    traverse,
    goBack,
  ]);

  /* -----------------------------------------------------
     Toast
  ----------------------------------------------------- */

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(
      () => setNotice(""),
      2500
    );

    return () =>
      window.clearTimeout(timeout);
  }, [notice]);

  /* -----------------------------------------------------
     Render
  ----------------------------------------------------- */

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            CF
          </div>

          <div>
            <div className="brand-name">
              CallFlow
            </div>

            <div className="brand-sub">
              Visual recruiter call-flow
              builder
            </div>
          </div>
        </div>

        <div className="top-actions">
          <button
            className={`button ${
              callMode
                ? "button-active"
                : ""
            }`}
            onClick={() => {
              setCallMode((previous) => {
                const next = !previous;

                if (next) {
                  setFlow((current) => ({
                    ...current,

                    history: [],

                    selectedId:
                      ROOT_ID,
                  }));
                }

                return next;
              });
            }}
          >
            ▶{" "}
            {callMode
              ? "Exit Call Mode"
              : "Call Mode"}
          </button>

          <button
            className="button primary"
            onClick={() =>
              addNode()
            }
          >
            ＋ Add Node
          </button>

          <button
            className="button ghost"
            onClick={resetFlow}
          >
            Reset
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="canvas-panel">
          <FlowCanvas
            nodes={flow.nodes}
            currentId={currentId}
            selectedId={
              flow.selectedId
            }
            history={flow.history}
            onNodesChange={
              updateNodes
            }
            onSelect={selectNode}
            onTraverse={traverse}
            fitNonce={fitNonce}
            traversalActive={
              callMode
            }
          />

          <div className="canvas-hint">
            Drag nodes to arrange ·
            drag empty space to pan ·
            scroll / pinch to zoom
          </div>
        </section>

        <aside className="editor-panel">
          {callMode ? (
            <CallPanel
              nodesById={nodesById}
              currentId={currentId}
              history={flow.history}
              onTraverse={traverse}
              onBack={goBack}
              onExit={() =>
                setCallMode(false)
              }
            />
          ) : (
            <Editor
              node={
                nodesById[
                  flow.selectedId
                ] ||
                nodesById[ROOT_ID]
              }
              nodes={flow.nodes}
              onChange={
                updateNodeData
              }
              onOutcome={
                updateOutcome
              }
              onAddOutcome={
                addOutcome
              }
              onRemoveOutcome={
                removeOutcome
              }
              onCreateChild={(
                nodeId,
                outcomeId,
                label
              ) =>
                addNode(
                  nodeId,
                  outcomeId,
                  label
                )
              }
              onDuplicate={
                duplicateNode
              }
              onDelete={
                deleteNode
              }
            />
          )}
        </aside>
      </main>

      {notice && (
        <div className="toast">
          {notice}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------
   Flow Canvas
------------------------------------------------------- */

function FlowCanvas({
  nodes,
  currentId,
  selectedId,
  history,
  onNodesChange,
  onSelect,
  fitNonce,
  traversalActive,
}) {
  const { fitView } =
    useReactFlow();

  const nodeMap = useMemo(
    () =>
      Object.fromEntries(
        nodes.map((node) => [
          node.id,
          node,
        ])
      ),
    [nodes]
  );

  const visited = useMemo(
    () =>
      new Set([
        ROOT_ID,
        ...history.map(
          (item) => item.nodeId
        ),
      ]),
    [history]
  );

  const activeNext = useMemo(
    () => {
      if (!traversalActive) {
        return new Set();
      }

      return new Set(
        (
          nodeMap[currentId]
            ?.data?.outcomes || []
        )
          .map(
            (outcome) =>
              outcome.targetId
          )
          .filter(Boolean)
      );
    },
    [
      nodeMap,
      currentId,
      traversalActive,
    ]
  );

  const flowNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,

        data: {
          ...node.data,

          current:
            traversalActive &&
            node.id === currentId,

          selected:
            node.id === selectedId,

          visited:
            traversalActive &&
            visited.has(node.id),

          activeNext:
            traversalActive &&
            activeNext.has(node.id),
        },
      })),
    [
      nodes,
      currentId,
      selectedId,
      visited,
      activeNext,
      traversalActive,
    ]
  );

  const edges = useMemo(
    () =>
      nodes.flatMap((node) =>
        (node.data?.outcomes || [])
          .filter(
            (outcome) =>
              outcome.targetId &&
              nodeMap[
                outcome.targetId
              ]
          )
          .map((outcome) => ({
            id: `${node.id}-${outcome.id}`,

            source: node.id,

            sourceHandle: `source-${outcome.id}`,

            target:
              outcome.targetId,

            targetHandle: "target",

            type: "smoothstep",

            animated:
              traversalActive &&
              node.id ===
                currentId,

            label:
              outcome.label ||
              "Response",

            markerEnd: {
              type:
                MarkerType.ArrowClosed,
            },

            className:
              traversalActive &&
              node.id === currentId
                ? "flow-edge edge-active"
                : "flow-edge",

            labelStyle: {
              fill: "#b9c1d0",
              fontSize: 11,
              fontWeight: 700,
            },

            labelBgStyle: {
              fill: "#11151e",
              fillOpacity: 0.96,
            },
          }))
      ),
    [
      nodes,
      nodeMap,
      currentId,
      traversalActive,
    ]
  );

  useEffect(() => {
    if (!fitNonce) {
      return;
    }

    const timer =
      window.setTimeout(() => {
        fitView({
          padding: 0.2,
          duration: 350,
        });
      }, 0);

    return () =>
      window.clearTimeout(timer);
  }, [fitNonce, fitView]);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={edges}
      nodeTypes={{
        conversation:
          ConversationNode,
      }}
      onNodesChange={
        onNodesChange
      }
      onNodeClick={(_, node) =>
        onSelect(node.id)
      }
      fitView
      minZoom={0.25}
      maxZoom={1.8}
      panOnScroll
      panOnDrag
      selectionOnDrag={false}
      zoomOnScroll={false}
      zoomOnPinch
      defaultEdgeOptions={{
        type: "smoothstep",
      }}
      proOptions={{
        hideAttribution: true,
      }}
    >
      <Background
        gap={24}
        size={1}
        color="#1c2330"
      />

      <Controls
        showInteractive={false}
      />

      <MiniMap
        nodeColor={(node) =>
          node.id === currentId
            ? "#a8e6cf"
            : "#3a4353"
        }
        maskColor="rgba(7,9,13,.75)"
      />
    </ReactFlow>
  );
}

/* -------------------------------------------------------
   Conversation Node
------------------------------------------------------- */

function ConversationNode({
  id,
  data,
}) {
  return (
    <div
      className={[
        "conversation-node",

        data.current
          ? "is-current"
          : "",

        data.selected
          ? "is-selected"
          : "",

        data.visited
          ? "is-visited"
          : "",

        data.activeNext
          ? "is-next"
          : "",

        data.end
          ? "is-end"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="target"
      />

      <div className="node-kicker">
        {data.end
          ? "END NODE"
          : id === ROOT_ID
          ? "START NODE"
          : "CONVERSATION STEP"}
      </div>

      <div className="node-title">
        {data.title ||
          "Untitled node"}
      </div>

      {data.question && (
        <div className="node-question">
          {data.question}
        </div>
      )}

      {data.script && (
        <div className="node-script">
          “{data.script}”
        </div>
      )}

      {(data.outcomes || []).map(
        (outcome, index) => (
          <div
            className="node-outcome"
            key={outcome.id}
          >
            <span className="outcome-dot" />

            <span>
              {outcome.label ||
                `Response ${
                  index + 1
                }`}
            </span>

            <Handle
              type="source"
              position={Position.Right}
              id={`source-${outcome.id}`}
              className="outcome-handle"
            />
          </div>
        )
      )}
    </div>
  );
}

/* -------------------------------------------------------
   Editor
------------------------------------------------------- */

function Editor({
  node,
  nodes,
  onChange,
  onOutcome,
  onAddOutcome,
  onRemoveOutcome,
  onCreateChild,
  onDuplicate,
  onDelete,
}) {
  const [draft, setDraft] =
    useState(
      node?.data || {}
    );

  useEffect(() => {
    setDraft(
      node?.data || {}
    );
  }, [node?.id, node?.data]);

  if (!node) {
    return null;
  }

  const save = () =>
    onChange(
      node.id,
      draft
    );

  const destinationOptions =
    nodes.filter(
      (item) =>
        item.id !== node.id
    );

  return (
    <div className="editor-content">
      <div className="panel-eyebrow">
        NODE EDITOR
      </div>

      <h2>
        {node.data.title ||
          "Conversation node"}
      </h2>

      <p className="muted">
        Build the conversation
        yourself. A node can have
        any number of response
        branches — YES, NO, MAYBE,
        or your own label.
      </p>

      <label>
        NODE TITLE

        <input
          value={
            draft.title || ""
          }
          onChange={(event) =>
            setDraft((previous) => ({
              ...previous,
              title:
                event.target.value,
            }))
          }
          placeholder="Currently available?"
        />
      </label>

      <label>
        QUESTION / CONCLUSION

        <textarea
          rows="3"
          value={
            draft.question || ""
          }
          onChange={(event) =>
            setDraft((previous) => ({
              ...previous,
              question:
                event.target.value,
            }))
          }
          placeholder="What are you asking or concluding?"
        />
      </label>

      <label>
        SCRIPT — WHAT I SAY

        <textarea
          rows="5"
          value={
            draft.script || ""
          }
          onChange={(event) =>
            setDraft((previous) => ({
              ...previous,
              script:
                event.target.value,
            }))
          }
          placeholder="Exact words you want to say on the call..."
        />
      </label>

      <div className="section-heading">
        <span>
          RESPONSE BRANCHES
        </span>

        <button
          className="tiny-button"
          onClick={() =>
            onAddOutcome(node.id)
          }
        >
          ＋ Add branch
        </button>
      </div>

      <div className="outcome-editor-list">
        {(draft.outcomes || [])
          .map((outcome) => (
            <div
              className="outcome-editor"
              key={outcome.id}
            >
              <div className="outcome-row">
                <input
                  className="branch-label"
                  value={
                    outcome.label ||
                    ""
                  }
                  onChange={(
                    event
                  ) => {
                    const next =
                      (
                        draft.outcomes ||
                        []
                      ).map(
                        (item) =>
                          item.id ===
                          outcome.id
                            ? {
                                ...item,
                                label:
                                  event
                                    .target
                                    .value,
                              }
                            : item
                      );

                    setDraft(
                      (previous) => ({
                        ...previous,
                        outcomes:
                          next,
                      })
                    );
                  }}
                  placeholder="YES / NO / MAYBE"
                />

                <button
                  className="icon-button danger"
                  onClick={() => {
                    onRemoveOutcome(
                      node.id,
                      outcome.id
                    );

                    setDraft(
                      (previous) => ({
                        ...previous,
                        outcomes:
                          (
                            previous.outcomes ||
                            []
                          ).filter(
                            (item) =>
                              item.id !==
                              outcome.id
                          ),
                      })
                    );
                  }}
                >
                  ×
                </button>
              </div>

              <select
                value={
                  outcome.targetId ||
                  ""
                }
                onChange={(
                  event
                ) => {
                  const next =
                    (
                      draft.outcomes ||
                      []
                    ).map(
                      (item) =>
                        item.id ===
                        outcome.id
                          ? {
                              ...item,
                              targetId:
                                event
                                  .target
                                  .value ||
                                null,
                            }
                          : item
                    );

                  setDraft(
                    (previous) => ({
                      ...previous,
                      outcomes:
                        next,
                    })
                  );
                }}
              >
                <option value="">
                  No destination yet
                </option>

                {destinationOptions.map(
                  (destination) => (
                    <option
                      key={
                        destination.id
                      }
                      value={
                        destination.id
                      }
                    >
                      {destination
                        .data
                        .title ||
                        "Untitled node"}
                    </option>
                  )
                )}
              </select>

              <button
                className="subtle-button"
                onClick={() =>
                  onCreateChild(
                    node.id,
                    outcome.id,
                    outcome.label ||
                      "Response"
                  )
                }
              >
                ＋ Create new child
                node
              </button>
            </div>
          ))}

        {!(draft.outcomes || [])
          .length && (
          <div className="empty-branches">
            No branches yet. Add one
            and label it anything you
            want.
          </div>
        )}
      </div>

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={Boolean(
            draft.end
          )}
          onChange={(event) =>
            setDraft((previous) => ({
              ...previous,

              end: event.target.checked,

              outcomes:
                event.target.checked
                  ? []
                  : previous.outcomes,
            }))
          }
        />

        <span>
          <strong>
            End of call node
          </strong>

          <small>
            No response branches.
            This is where the
            conversation ends.
          </small>
        </span>
      </label>

      <div className="editor-actions">
        <button
          className="button primary wide"
          onClick={save}
        >
          Save Changes
        </button>

        <button
          className="button"
          onClick={() =>
            onDuplicate(node.id)
          }
        >
          Duplicate
        </button>
      </div>

      <button
        className="delete-link"
        onClick={() =>
          onDelete(node.id)
        }
        disabled={node.id === ROOT_ID}
      >
        Delete Node
      </button>
    </div>
  );
}

/* -------------------------------------------------------
   Call Panel
------------------------------------------------------- */

function CallPanel({
  nodesById,
  currentId,
  history,
  onTraverse,
  onBack,
  onExit,
}) {
  const node =
    nodesById[currentId];

  const outcomes =
    node?.data?.outcomes ||
    [];

  return (
    <div className="call-panel">
      <div className="call-topline">
        <span className="live-dot" />

        CALL IN PROGRESS

        <button
          onClick={onExit}
        >
          Esc
        </button>
      </div>

      <div className="breadcrumbs">
        <span>Introduction</span>

        {history.map(
          (item, index) => (
            <React.Fragment
              key={`${item.nodeId}-${index}`}
            >
              <b>›</b>

              <span>
                {item.via}
              </span>

              <b>›</b>

              <span>
                {
                  nodesById[
                    item.nodeId
                  ]?.data?.title
                }
              </span>
            </React.Fragment>
          )
        )}
      </div>

      <div className="call-card">
        <div className="panel-eyebrow">
          CURRENT STEP
        </div>

        <h1>
          {node?.data?.title ||
            "Untitled node"}
        </h1>

        {node?.data?.question && (
          <p className="call-question">
            {node.data.question}
          </p>
        )}

        <div className="say-box">
          <div className="panel-eyebrow">
            SAY THIS
          </div>

          <p>
            {node?.data?.script ||
              "No script written for this node yet."}
          </p>
        </div>

        {node?.data?.end ? (
          <div className="end-call-message">
            END OF CALL
          </div>
        ) : (
          <div className="call-branches">
            {outcomes.length ===
            0 ? (
              <div className="empty-branches">
                This node has no
                response branches
                yet.
              </div>
            ) : (
              outcomes.map(
                (outcome) => (
                  <button
                    key={
                      outcome.id
                    }
                    className="call-choice"
                    onClick={() =>
                      onTraverse(
                        currentId,
                        outcome.id
                      )
                    }
                  >
                    {
                      outcome.label ||
                      "Response"
                    }

                    <span>
                      →
                    </span>
                  </button>
                )
              )
            )}
          </div>
        )}
      </div>

      <div className="call-footer">
        <button
          className="button"
          onClick={onBack}
          disabled={
            !history.length
          }
        >
          ← Back
        </button>

        <span>
          Y / N / M shortcuts work
          in Call Mode
        </span>

        <button
          className="button ghost"
          onClick={onExit}
        >
          End Call
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------
   Provider
------------------------------------------------------- */

function AppWithProvider() {
  return (
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  );
}

/* -------------------------------------------------------
   Mount
------------------------------------------------------- */

const rootElement =
  document.getElementById(
    "root"
  );

if (!rootElement) {
  throw new Error(
    'Could not find <div id="root"></div> in index.html'
  );
}

createRoot(rootElement).render(
  <React.StrictMode>
    <AppWithProvider />
  </React.StrictMode>
);