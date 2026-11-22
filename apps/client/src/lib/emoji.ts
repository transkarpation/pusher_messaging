export interface EmojiCategory {
  id: string;
  label: string;
  icon: string;
  emojis: string[];
}

const split = (s: string) => s.split(" ").filter(Boolean);

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "Smileys",
    icon: "😀",
    emojis: split(
      "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾",
    ),
  },
  {
    id: "people",
    label: "People & gestures",
    icon: "👋",
    emojis: split(
      "👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 💪 🦾 🧠 👀 👁️ 👅 👄 👶 🧒 👦 👧 🧑 👨 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🙇 🤦 🤷 🧑‍💻 🧑‍🎓 🧑‍🍳 🧑‍🚀 🦸 🦹 🧙 🧚 🧛 🧜 🧝 💃 🕺 🚶 🏃 👫 👭 👬 💏 💑 👪",
    ),
  },
  {
    id: "hearts",
    label: "Hearts & symbols",
    icon: "❤️",
    emojis: split(
      "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💯 💢 💥 💫 💦 💨 💬 💭 💤 ✨ ⭐ 🌟 🔥 ⚡ ✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ❓ ❔ ❗ ❕ ‼️ ⁉️ ⚠️ 🚫 ⛔ 🔞 ♻️ 🆗 🆒 🆕 🆓 🆘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🎵 🎶 ➡️ ⬅️ ⬆️ ⬇️ 🔁 🔄",
    ),
  },
  {
    id: "animals",
    label: "Animals & nature",
    icon: "🐶",
    emojis: split(
      "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🕷️ 🐢 🐍 🦎 🐙 🦑 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦒 🐪 🐄 🐎 🐖 🐑 🐐 🦌 🐕 🐈 🐓 🦃 🦚 🦜 🐇 🐿️ 🦔 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🍁 🍂 🍃 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌚 🌙 🌎 🪐 ☀️ ⛅ ☁️ 🌧️ ⛈️ 🌩️ ❄️ ☃️ ⛄ 🌈 🌊",
    ),
  },
  {
    id: "food",
    label: "Food & drink",
    icon: "🍕",
    emojis: split(
      "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🍞 🥖 🥨 🧀 🥚 🍳 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🥜 🍯 🥛 ☕ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊",
    ),
  },
  {
    id: "activities",
    label: "Activities & travel",
    icon: "⚽",
    emojis: split(
      "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🏒 🥊 🥋 ⛳ 🎣 🎽 🎿 🛷 ⛸️ 🏂 🏋️ 🤸 🚴 🏊 🧘 🏆 🥇 🥈 🥉 🏅 🎖️ 🎫 🎟️ 🎪 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🎻 🎲 ♟️ 🎯 🎳 🎮 🕹️ 🧩 🚗 🚕 🚙 🚌 🏎️ 🚓 🚑 🚒 🚚 🚜 🛵 🏍️ 🚲 🛴 🚂 🚆 🚇 ✈️ 🛫 🛬 🚀 🛸 🚁 ⛵ 🚤 🛳️ ⚓ 🗺️ 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🏖️ 🏝️ 🏔️ ⛺ 🏠 🏡 🏢 🏥 🏦 🏨 🏫 ⛪ 🌆 🌃 🌉",
    ),
  },
  {
    id: "objects",
    label: "Objects",
    icon: "💡",
    emojis: split(
      "⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💽 💾 💿 📷 📸 📹 🎥 📞 ☎️ 📺 📻 ⏰ ⏳ ⌛ 🔋 🔌 💡 🔦 🕯️ 💸 💵 💰 💳 💎 ⚖️ 🔧 🔨 🛠️ ⚙️ 🔩 🧲 🔫 💣 🔪 🛡️ 🔮 💊 💉 🧬 🦠 🧪 🌡️ 🧹 🧺 🧻 🚽 🛁 🔑 🗝️ 🚪 🛋️ 🛏️ 🧸 🎁 🎈 🎀 🎊 🎉 🪅 🎎 🏮 ✉️ 📩 📨 📧 💌 📦 🏷️ 📜 📃 📄 📑 📊 📈 📉 📅 📆 🗓️ 📇 📋 📁 📂 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🔗 📎 🖇️ 📐 📏 📌 📍 ✂️ 🖊️ 🖋️ ✒️ 🖌️ 🖍️ 📝 ✏️ 🔍 🔎 🔏 🔐 🔒 🔓",
    ),
  },
  {
    id: "flags",
    label: "Flags",
    icon: "🏳️",
    emojis: split(
      "🏳️ 🏴 🏁 🚩 🏳️‍🌈 🇺🇦 🇺🇸 🇬🇧 🇨🇦 🇩🇪 🇫🇷 🇪🇸 🇮🇹 🇵🇱 🇨🇿 🇸🇰 🇭🇺 🇷🇴 🇲🇩 🇱🇹 🇱🇻 🇪🇪 🇫🇮 🇸🇪 🇳🇴 🇩🇰 🇳🇱 🇧🇪 🇨🇭 🇦🇹 🇵🇹 🇬🇷 🇹🇷 🇮🇪 🇮🇱 🇯🇵 🇰🇷 🇨🇳 🇮🇳 🇦🇺 🇳🇿 🇧🇷 🇦🇷 🇲🇽 🇿🇦 🇪🇺 🇺🇳",
    ),
  },
];

const RECENT_KEY = "recent-emojis";
const RECENT_MAX = 24;

export function readRecentEmojis(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((e): e is string => typeof e === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Moves `emoji` to the front of the recent list and returns the new list. */
export function pushRecentEmoji(emoji: string): string[] {
  const next = [emoji, ...readRecentEmojis().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable (private mode); recents just won't persist.
  }
  return next;
}
