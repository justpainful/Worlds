import { useMemo, useState } from "react";
import { SearchField } from "./SearchField";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, errorMessage } from "../lib/api";
import { useStore } from "../state/store";
import { ICON_CATALOG } from "../assets/product-icons";
import { Popover } from "./Menu";
import { Icon } from "./Icon";
import { ProductIcon } from "./ProductIcon";

const SETS: { label: string; emojis: string }[] = [
  { label: "Objects", emojis: "📄 📝 📌 📎 📁 🗂️ 🗃️ 📚 📖 🔖 🏷️ 💼 🧾 📊 📈 📉 🗓️ 📅 ⏰ ⏱️ 🔔 📣 📢 💬 🗨️ ✉️ 📬 🔑 🔒 🔓 🧭 🗺️ 🧰 🛠️ ⚙️ 🧪 🔬 💡 🕯️ 🔦 🎯 🧩 🎨 🖌️ 🖼️ 🎬 🎧 🎮 🕹️ 💻 🖥️ ⌨️ 🖱️ 📱 📷 🎥 📺" },
  { label: "Symbols", emojis: "✅ ☑️ ✔️ ❌ ⭕ ❗ ❓ ⚠️ ⛔ 🚫 ♻️ ⭐ 🌟 ✨ 🔥 💥 💯 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔷 🔶 ➡️ ⬅️ ⬆️ ⬇️ 🔁 🔀 ➕ ➖ 💲 #️⃣ 🆕 🆗 🆒 🔝" },
  { label: "Places", emojis: "🏠 🏢 🏛️ 🏪 🏫 🏥 🏦 🏭 🏗️ 🌍 🌎 🌏 🌐 🏝️ 🏔️ 🌋 🏕️ 🌃 🌆 🌉 🚀 ✈️ 🚗 🚕 🚌 🚲 ⛵ 🚢 🛰️ 🪐 🌙 ☀️ ⛅ 🌧️ ❄️ 🌈 🌊" },
  { label: "Nature", emojis: "🌱 🌿 🍀 🌵 🌴 🌳 🌲 🍁 🍂 🌸 🌼 🌻 🌹 🍄 🐚 🪨 🐾 🐱 🐶 🦊 🐻 🐼 🦁 🐯 🐺 🦅 🦉 🐝 🦋 🐢 🐬 🐳" },
  { label: "Food", emojis: "☕ 🍵 🧃 🍕 🍔 🍟 🌮 🥗 🍣 🍜 🥐 🍞 🧁 🍰 🍫 🍪 🍎 🍊 🍋 🍉 🍇 🍓 🥑 🌶️" },
  { label: "People", emojis: "🙂 😊 😎 🤔 🤝 👋 👍 👏 🙌 💪 🧠 👀 👤 👥 🧑‍💻 🧑‍🎨 🧑‍🏫 🧑‍🔧 🎓 👑 🏆 🥇 🎉 🎁" },
];

type Mode = "icons" | "emoji";

/**
 * The page icon picker: product icons (searchable in English and Arabic),
 * emoji, or an uploaded picture. Values: "pi:<name>", "img:<attachment>", or an emoji.
 */
export function EmojiPicker({
  anchor,
  onPick,
  onClose,
  hasIcon,
  pageId = null,
}: {
  anchor: DOMRect;
  onPick: (e: string | null) => void;
  onClose: () => void;
  hasIcon: boolean;
  pageId?: string | null;
}) {
  const [mode, setMode] = useState<Mode>("icons");
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");
  const emojis = useMemo(() => SETS[tab].emojis.split(" ").filter(Boolean), [tab]);
  const cats = useMemo(() => ["All", ...Array.from(new Set(ICON_CATALOG.map((i) => i.category)))], []);
  const icons = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ICON_CATALOG.filter(
      (i) => (cat === "All" || i.category === cat) && (!s || `${i.name} ${i.label} ${i.keywords.join(" ")}`.toLowerCase().includes(s)),
    );
  }, [q, cat]);

  const upload = async () => {
    const path = await openDialog({ multiple: false, title: "Choose an icon image", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"] }] });
    if (!path || Array.isArray(path)) return;
    try {
      const a = await api.importFile(pageId, path);
      onPick(`img:${a.id}`);
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={372} className="emoji-pop">
      <div className="ip-head">
        <div className="ip-modes" role="tablist">
          <button role="tab" aria-selected={mode === "icons"} className={mode === "icons" ? "is-on" : ""} onClick={() => setMode("icons")}>Icons</button>
          <button role="tab" aria-selected={mode === "emoji"} className={mode === "emoji" ? "is-on" : ""} onClick={() => setMode("emoji")}>Emoji</button>
        </div>
        <span className="grow" />
        <button className="chip-btn" onClick={upload}>
          <Icon name="upload" size={13} />
          Upload
        </button>
        {hasIcon && (
          <button className="chip-btn" onClick={() => onPick(null)}>
            Remove
          </button>
        )}
      </div>

      {mode === "icons" ? (
        <>
          <SearchField autoFocus size="compact" className="ip-search" placeholder="Search icons" value={q} onChange={setQ} />
          <div className="ip-cats">
            {cats.map((c) => (
              <button key={c} className={`emoji-tab ${c === cat ? "is-active" : ""}`} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="ip-grid">
            {icons.map((i) => (
              <button key={i.name} className="ip-cell" onClick={() => onPick(`pi:${i.name}`)} data-tip={i.label} aria-label={i.label}>
                <ProductIcon name={i.name} size={38} />
              </button>
            ))}
            {icons.length === 0 && <div className="ip-none">No icons match</div>}
          </div>
        </>
      ) : (
        <>
          <div className="emoji-tabs">
            {SETS.map((s, i) => (
              <button key={s.label} className={`emoji-tab ${i === tab ? "is-active" : ""}`} onClick={() => setTab(i)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="emoji-grid">
            {emojis.map((e) => (
              <button key={e} className="emoji-cell" onClick={() => onPick(e)} aria-label={e}>
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </Popover>
  );
}
