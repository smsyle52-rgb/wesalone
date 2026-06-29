export default function AgentsHologram() {
  return (
    <figure
      className="agents-hologram"
      aria-label="وكلاء ذكاء اصطناعي هولوغرافيون"
    >
      <div className="agents-orbit orbit-one" />
      <div className="agents-orbit orbit-two" />
      <img
        src="/assets/wesal/agents-hero-reference.png"
        alt="مشهد وكلاء ذكاء اصطناعي بإضاءة زرقاء فوق لوحة تشغيل"
        loading="eager"
      />
    </figure>
  );
}
