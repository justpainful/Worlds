/**
 * The support site is public, so it draws Lucide icons (ISC, the same set the
 * Worlds app uses) instead of SF Symbols, under the names the shared controls use.
 */
import {
  AtSign, Ban, Calendar, ChartColumn, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, CirclePause, CirclePlay, CircleUser, Clock, Copy,
  Ellipsis, ExternalLink, FileText, FingerprintPattern, Globe, Hand, Hash, IdCard, Inbox, Info, KeyRound, Languages, Laptop, Layers, Link, ListChecks,
  ListFilter, Lock, LogOut, Mail, Monitor, Moon, Pencil, Plus, RotateCw, Search, Shield, Smartphone, StickyNote, Sun, SunMoon, Terminal, Trash,
  TriangleAlert, UserCog, Users, UserX, X, type LucideIcon,
} from "lucide-react";
import type { SymbolName } from "../../admin/src/symbols";
import type { IconProps } from "../../admin/src/ui";

const MAP: Partial<Record<SymbolName, LucideIcon>> = {
  magnifyingglass: Search,
  xmark: X,
  "chevron.left": ChevronLeft,
  "chevron.right": ChevronRight,
  "chevron.down": ChevronDown,
  "chevron.up.chevron.down": ChevronsUpDown,
  checkmark: Check,
  envelope: Mail,
  "exclamationmark.triangle": TriangleAlert,
  "person.crop.circle": CircleUser,
  key: KeyRound,
  trash: Trash,
  "hand.raised": Hand,
  lock: Lock,
  "character.bubble": Languages,
  "ellipsis.circle": Ellipsis,
  "arrow.clockwise": RotateCw,
  "sun.max": Sun,
  moon: Moon,
  "circle.lefthalf.filled": SunMoon,
  "text.document": FileText,
  "arrow.up.right.square": ExternalLink,
  plus: Plus,
  "rectangle.portrait.and.arrow.right": LogOut,
  tray: Inbox,
  "info.circle": Info,
  "line.3.horizontal.decrease.circle": ListFilter,
  "text.page": StickyNote,
  "document.on.document": Copy,
  link: Link,
  calendar: Calendar,
  clock: Clock,
  at: AtSign,
  touchid: FingerprintPattern,
  "shield.lefthalf.filled": Shield,
  globe: Globe,
  iphone: Smartphone,
  laptopcomputer: Laptop,
  desktopcomputer: Monitor,
  "apple.terminal": Terminal,
  "square.stack.3d.up": Layers,
  "person.2": Users,
  "list.bullet.rectangle": ListChecks,
  "person.badge.key": UserCog,
  "chart.bar.xaxis": ChartColumn,
  "pause.circle": CirclePause,
  "play.circle": CirclePlay,
  nosign: Ban,
  pencil: Pencil,
  "number.sign": Hash,
  "person.text.rectangle": IdCard,
  "person.crop.circle.badge.xmark": UserX,
};

export function lucideIcon(name: SymbolName, p: IconProps) {
  const C = MAP[name];
  if (!C) return null;
  return (
    <C
      className={p.className}
      data-m={p["data-m"]}
      size={p.size}
      strokeWidth={1.9}
      aria-label={p.label}
      aria-hidden={p.label ? undefined : true}
      role={p.label ? "img" : undefined}
      focusable="false"
    />
  );
}
