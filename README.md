# CallFlow

A React + Vite visual conversation builder for live physician-recruiter calls.

## Stack
- React 19.3
- Vite 8.2
- React Flow (`@xyflow/react`) 12.11
- LocalStorage persistence

## Run
```bash
npm install
npm run dev
```

Then open the local URL Vite prints.

## Model
CallFlow is intentionally **not** a binary tree. Each node owns an arbitrary `outcomes` array:

```js
{
  id: 'node-1',
  data: {
    title: 'Currently available?',
    question: 'Are you currently available for locums?',
    script: '...',
    end: false,
    outcomes: [
      { id: 'yes', label: 'YES', targetId: 'node-2' },
      { id: 'no', label: 'NO', targetId: 'node-3' },
      { id: 'maybe', label: 'MAYBE', targetId: 'node-4' }
    ]
  }
}
```

That means a node can have 0, 1, 2, 3, or many response branches. A branch can point to an existing node or create a brand-new child node.

The initial state is deliberately only one clean **Introduction** root node. Reset returns to that clean state; it does not preload the old recruiter demo.
