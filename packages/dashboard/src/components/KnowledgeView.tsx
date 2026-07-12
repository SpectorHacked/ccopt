'use client';
import { useState } from 'react';
import { KnowledgeLive } from './KnowledgeLive.tsx';
import { KnowledgeGraphExplorer } from './KnowledgeGraphExplorer.tsx';

/** Knowledge tab: an interactive graph explorer (default) or the fact list. */
export function KnowledgeView({ agent }: { agent: string }) {
  const [mode, setMode] = useState<'graph' | 'list'>('graph');
  return (
    <div className="page-stack">
      <div className="kg-toggle">
        <button className={mode === 'graph' ? 'active' : ''} onClick={() => setMode('graph')}>Graph explorer</button>
        <button className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')}>Fact list</button>
      </div>
      {mode === 'graph' ? <KnowledgeGraphExplorer agent={agent} /> : <KnowledgeLive agent={agent} />}
    </div>
  );
}
