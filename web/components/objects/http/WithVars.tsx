export function WithVars({ text }: { text: string }) {
  return <>{text.split(/(\{\{[^}]+\}\})/g).map((p, i) => (p.startsWith('{{') ? <span key={i} className="hr-var">{p}</span> : p))}</>;
}
