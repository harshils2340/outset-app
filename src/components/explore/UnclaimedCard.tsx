import { ICONS } from "../../data/icons";
import type { Unclaimed } from "../../data/types";
import { money } from "../../lib/format";
import { useApp } from "../../state/AppProvider";
import { Art } from "../art/Art";
import { Markup } from "../Markup";

export function UnclaimedCard({ item }: { item: Unclaimed }) {
  const { openRequest } = useApp();
  return (
    <button className="card unclaimed" onClick={() => openRequest(item.id)}>
      <div className="art" style={{ filter: "saturate(.35) brightness(.94)" }}>
        <Art kind={item.art} id={item.id} />
        <span className="unbadge">Unclaimed</span>
      </div>
      <div className="body">
        <h3>{item.title}</h3>
        <div className="op">
          {item.area} · pulled from <span className="mono">{item.src}</span>
        </div>
        <div className="specrow">
          {item.specs.map((s) => (
            <span className="spec" key={s}>
              {s}
            </span>
          ))}
        </div>
        {item.options.length ? (
          <div className="ulines">
            {item.options.map((o, i) => (
              <div className="uline" key={o.name + i}>
                <span>
                  {o.name}
                  {o.detail ? (
                    <>
                      {" "}
                      <i>· {o.detail}</i>
                    </>
                  ) : null}
                </span>
                <b>{o.price == null ? "ask" : money(o.price) + (o.per || "")}</b>
              </div>
            ))}
          </div>
        ) : null}
        {item.includes.length ? (
          <div className="uincludes">
            <Markup html={ICONS.dot} />
            <span>Includes {item.includes.join(", ")}</span>
          </div>
        ) : null}
        <div className="ugap">{item.gap}</div>
        {item.extraNote ? (
          <div className="ugap" style={{ color: "var(--ink-faint)" }}>
            {item.extraNote}
          </div>
        ) : null}
        <div className="foot">
          <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>No live availability yet</span>
          <span className="link">
            Request info <Markup html={ICONS.arrow} />
          </span>
        </div>
      </div>
    </button>
  );
}
