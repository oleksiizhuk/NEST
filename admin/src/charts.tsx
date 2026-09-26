import { TeamHistory, WeeklyFlow } from './api';

// Two small inline charts: weekly bars for the team (closed vs arrived) and
// a sparkline of one person's closed tasks. Native <title> tooltips on every
// bar; numbers are also in the text next to them.

const week = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
};

export function TeamFlowChart({ flow }: { flow: WeeklyFlow }) {
  const n = flow.weeks.length;
  const max = Math.max(1, ...flow.done, ...flow.created);
  const W = 560;
  const H = 120;
  const slot = W / n;
  const bar = Math.max(4, Math.min(14, slot / 2 - 4));
  const y = (v: number) => H - (v / max) * H;
  return (
    <figure className="flow-chart">
      <svg
        viewBox={`0 0 ${W} ${H + 20}`}
        role="img"
        aria-label="Закрыто и пришло задач по неделям"
      >
        <line x1={0} x2={W} y1={H} y2={H} className="axis" />
        {flow.weeks.map((w, i) => {
          const x = i * slot + slot / 2;
          const partial = i === n - 1;
          return (
            <g key={w} className={partial ? 'partial' : ''}>
              <rect
                className="bar done"
                x={x - bar - 1}
                y={y(flow.done[i])}
                width={bar}
                height={H - y(flow.done[i])}
                rx={2}
              >
                <title>
                  Неделя с {week(w)}: закрыто {flow.done[i]}
                  {partial ? ' (неделя идёт)' : ''}
                </title>
              </rect>
              <rect
                className="bar created"
                x={x + 1}
                y={y(flow.created[i])}
                width={bar}
                height={H - y(flow.created[i])}
                rx={2}
              >
                <title>
                  Неделя с {week(w)}: пришло {flow.created[i]}
                  {partial ? ' (неделя идёт)' : ''}
                </title>
              </rect>
              {(i % 2 === n % 2 || partial) && (
                <text x={x} y={H + 14} className="tick">
                  {week(w)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="legend">
        <span>
          <i className="swatch done" /> закрыто
        </span>
        <span>
          <i className="swatch created" /> пришло новых
        </span>
        <span className="muted">последняя неделя ещё идёт</span>
      </figcaption>
    </figure>
  );
}

export function Sparkline({
  values,
  weeks,
}: {
  values: number[];
  weeks: string[];
}) {
  const max = Math.max(1, ...values);
  const W = 120;
  const H = 28;
  const slot = W / values.length;
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Закрыто по неделям: ${values.join(', ')}`}
    >
      {values.map((v, i) => (
        <rect
          key={i}
          className={`bar done${i === values.length - 1 ? ' partial' : ''}`}
          x={i * slot + 1}
          y={H - Math.max(v ? 2 : 1, (v / max) * H)}
          width={Math.max(2, slot - 2)}
          height={Math.max(v ? 2 : 1, (v / max) * H)}
          rx={1}
        >
          <title>
            Неделя с {week(weeks[i] ?? '')}: закрыто {v}
          </title>
        </rect>
      ))}
    </svg>
  );
}

// People × days, shade = open work that day (in progress + queue), one hue
export function LoadHeatmap({ h }: { h: TeamHistory }) {
  const open = (c: TeamHistory['people'][number]['days'][number]) =>
    c ? c.inProgress + c.queue : null;
  // The scale tops out at the 90th percentile so one outlier does not make
  // everyone else look empty
  const values = h.people
    .flatMap((p) => p.days.map((c) => open(c) ?? 0))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const max = Math.max(
    1,
    values[Math.floor(values.length * 0.9)] ?? values[values.length - 1] ?? 1,
  );
  const weekend = (d: string) => {
    const w = new Date(`${d}T00:00:00Z`).getUTCDay();
    return w === 0 || w === 6;
  };
  return (
    <div className="heatmap-wrap">
      <table className="heatmap">
        <thead>
          <tr>
            <th />
            {h.days.map((d, i) => (
              <th key={d} className={`day${weekend(d) ? ' we' : ''}`}>
                {(i % 7 === 0 || i === h.days.length - 1) && (
                  <span className="lbl">{week(d)}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {h.people.map((p) => (
            <tr key={p.name}>
              <th className="who">{p.name}</th>
              {p.days.map((c, i) => {
                const v = open(c);
                return (
                  <td
                    key={h.days[i]}
                    className={`${weekend(h.days[i]) ? 'we' : ''}${
                      v === null ? ' none' : ''
                    }`}
                    style={v ? { opacity: 0.15 + 0.85 * (v / max) } : undefined}
                    aria-label={
                      c
                        ? `${week(h.days[i])}: открыто ${v}`
                        : `${week(h.days[i])}: нет данных`
                    }
                    title={
                      c
                        ? `${p.name} · ${week(h.days[i])}: в работе ${
                            c.inProgress
                          }, очередь ${c.queue}, закрыто за 14 дн. ${
                            c.closed14
                          }`
                        : `${p.name} · ${week(h.days[i])}: нет данных`
                    }
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
