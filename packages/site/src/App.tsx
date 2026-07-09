import { motion } from 'framer-motion';
import { Hero3D } from './Hero3D.tsx';

const agents = [
  'Claude Code', 'OpenAI Codex', 'LangGraph', 'CrewAI', 'AutoGen',
  'OpenAI Agents SDK', 'hermes', 'MCP servers', 'n8n', 'Ollama',
];

const clarity = [
  { k: '01', t: 'See every execution', d: 'Any agent, any framework, normalized into one execution graph — token by token, tool by tool.' },
  { k: '02', t: 'Cut the waste', d: 'Repeated reasoning becomes deterministic tools, cached results, and cheaper models — automatically.' },
  { k: '03', t: 'Ship with confidence', d: 'Every optimization is replayed and validated against real history before it ever goes live.' },
];

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.55, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] } }),
};

export default function App() {
  return (
    <div className="site">
      <nav className="nav">
        <div className="logo"><span className="logo-mark" /> Optimizer</div>
        <div className="nav-links">
          <a href="#agents">Agents</a>
          <a href="#how">How it works</a>
          <a href="#" className="ghost">Docs</a>
          <a href="#" className="cta-sm">Open dashboard</a>
        </div>
      </nav>

      <header className="hero">
        <Hero3D />
        <div className="hero-fade" />
        <motion.div className="hero-copy" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.09 } } }}>
          <motion.div className="eyebrow" variants={fadeUp}>The self-optimizing runtime for AI agents</motion.div>
          <motion.h1 variants={fadeUp}>Your agents stop<br />repeating themselves.</motion.h1>
          <motion.p variants={fadeUp}>
            Optimizer watches every execution, turns repeated reasoning into deterministic tools, and cuts
            cost and latency — across any agent framework, with zero code changes.
          </motion.p>
          <motion.div className="hero-ctas" variants={fadeUp}>
            <a className="btn primary" href="#">Install in 2 minutes</a>
            <a className="btn ghost" href="#">Open dashboard →</a>
          </motion.div>
        </motion.div>
      </header>

      <section className="agents" id="agents">
        <motion.p className="section-eyebrow" initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }} variants={fadeUp}>
          Works with every agent — one install, no lock-in
        </motion.p>
        <motion.div className="agent-grid" initial="hidden" whileInView="show" viewport={{ once: true, margin: '-60px' }}
          variants={{ show: { transition: { staggerChildren: 0.05 } } }}>
          {agents.map((a) => (
            <motion.div key={a} className="agent-chip" variants={fadeUp} whileHover={{ y: -3, borderColor: 'rgba(124,92,255,0.5)' }}>
              <span className="chip-dot" /> {a}
            </motion.div>
          ))}
        </motion.div>
      </section>

      <section className="how" id="how">
        <motion.h2 initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }} variants={fadeUp}>
          Everything gets clearer.
        </motion.h2>
        <div className="how-grid">
          {clarity.map((c, i) => (
            <motion.div key={c.k} className="how-card" custom={i}
              initial="hidden" whileInView="show" viewport={{ once: true, margin: '-60px' }} variants={fadeUp}>
              <div className="how-k">{c.k}</div>
              <h3>{c.t}</h3>
              <p>{c.d}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <footer className="foot">
        <div className="logo"><span className="logo-mark" /> Optimizer</div>
        <span>The compiler for AI agents · © 2026</span>
      </footer>
    </div>
  );
}
