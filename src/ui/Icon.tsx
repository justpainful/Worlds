/**
 * The single icon system.
 *
 * Every glyph renders through this component with one stroke weight, round
 * caps/joins and optical size adjustments, so the set reads as one family.
 * Geometry comes from Lucide (ISC); the Discord glyph is drawn to the same
 * grid and stroke rules.
 */
import {
  FileText, Files, Plus, X, ChevronLeft, ChevronRight, ChevronDown, Search, Pin, PinOff, Star, Ellipsis,
  Share, PanelLeft, PanelRight, Columns2, Rows2, PanelsTopLeft, Image, Video, File, Upload, Link, AtSign,
  Heading1, Heading2, Heading3, List, ListOrdered, ListTodo, TextQuote, SquareCode, Table2, SeparatorHorizontal,
  Highlighter, SquareTerminal, ScrollText, LayoutTemplate, History, Undo2, Redo2, Archive, ArchiveRestore, Trash2,
  Copy, FolderInput, Workflow, Clock, CalendarClock, Calendar, Hash, User, MessageCircle, SendHorizontal, Eye,
  PenLine, CircleUser, Settings2, Activity, Crown, Lock, House, Check, Square, Globe, LayoutGrid, Rows3,
  PanelLeftClose, PanelLeftOpen, Smile, Type, Lightbulb, GripVertical, CornerDownRight, Folder, Wand, ArrowUpRight,
  RotateCcw, ExternalLink, FolderOpen, Minus, Bell, Paperclip, Play, Pause, Info, TriangleAlert, CircleCheck,
  CircleX, Loader, Unplug, Server, Monitor, Keyboard, Database, Languages, Palette, Layers, Inbox, ArrowLeft,
  ArrowRight, AlignLeft, AlignCenter, AlignRight, Download, RefreshCw, SlidersHorizontal, Repeat, Megaphone, Users,
  ShieldCheck, Command, Copy as Restore, Expand, ArrowUp, Mic, type LucideIcon,
} from "lucide-react";
import type { CSSProperties, SVGProps } from "react";

const Discord = (props: SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }) => {
  // The Discord mark, filled (a stroked outline reads as a smudge at toolbar sizes).
  const { size = 24, strokeWidth: _sw, fill: _f, ...rest } = props;
  void _sw;
  void _f;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...rest}>
      <path d="M19.27 5.33A16.6 16.6 0 0 0 15.18 4.06a.06.06 0 0 0-.07.03c-.18.32-.38.73-.52 1.06a15.3 15.3 0 0 0-4.6 0 10.6 10.6 0 0 0-.53-1.06.07.07 0 0 0-.07-.03c-1.43.25-2.81.68-4.09 1.27a.06.06 0 0 0-.03.02C2.68 9.24 1.97 13.05 2.32 16.81a.07.07 0 0 0 .03.05 16.7 16.7 0 0 0 5.03 2.54.07.07 0 0 0 .07-.02c.39-.53.73-1.09 1.03-1.68a.06.06 0 0 0-.04-.09 11 11 0 0 1-1.57-.75.07.07 0 0 1-.01-.11l.31-.24a.06.06 0 0 1 .07-.01c3.29 1.5 6.86 1.5 10.11 0a.06.06 0 0 1 .07.01l.31.25a.07.07 0 0 1-.01.11c-.5.29-1.03.54-1.57.75a.07.07 0 0 0-.04.09c.3.59.65 1.15 1.03 1.68a.07.07 0 0 0 .07.02 16.6 16.6 0 0 0 5.04-2.54.07.07 0 0 0 .03-.05c.42-4.35-.7-8.12-2.96-11.46a.05.05 0 0 0-.03-.02ZM8.68 14.52c-.99 0-1.81-.91-1.81-2.03s.8-2.03 1.81-2.03c1.02 0 1.83.92 1.81 2.03 0 1.12-.8 2.03-1.81 2.03Zm6.68 0c-.99 0-1.81-.91-1.81-2.03s.8-2.03 1.81-2.03c1.02 0 1.83.92 1.81 2.03 0 1.12-.79 2.03-1.81 2.03Z" />
    </svg>
  );
};

type IconComp = LucideIcon | typeof Discord;

const REGISTRY = {
  page: FileText,
  subpage: CornerDownRight,
  pages: Files,
  add: Plus,
  close: X,
  back: ChevronLeft,
  forward: ChevronRight,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  chevronDown: ChevronDown,
  search: Search,
  pin: Pin,
  unpin: PinOff,
  favorite: Star,
  more: Ellipsis,
  share: Share,
  splitLeft: PanelLeft,
  splitRight: PanelRight,
  splitVertical: Columns2,
  splitHorizontal: Rows2,
  tabs: PanelsTopLeft,
  image: Image,
  video: Video,
  file: File,
  upload: Upload,
  download: Download,
  link: Link,
  mention: AtSign,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  bulletList: List,
  numberedList: ListOrdered,
  checklist: ListTodo,
  quote: TextQuote,
  code: SquareCode,
  table: Table2,
  divider: SeparatorHorizontal,
  highlight: Highlighter,
  prompt: SquareTerminal,
  instructions: ScrollText,
  template: LayoutTemplate,
  history: History,
  undo: Undo2,
  redo: Redo2,
  archive: Archive,
  unarchive: ArchiveRestore,
  delete: Trash2,
  duplicate: Copy,
  move: FolderInput,
  automation: Workflow,
  clock: Clock,
  schedule: CalendarClock,
  calendar: Calendar,
  discord: Discord,
  channel: Hash,
  user: User,
  users: Users,
  dm: MessageCircle,
  send: SendHorizontal,
  preview: Eye,
  edit: PenLine,
  profile: CircleUser,
  settings: Settings2,
  activity: Activity,
  owner: Crown,
  lock: Lock,
  home: House,
  check: Check,
  globe: Globe,
  grid: LayoutGrid,
  listView: Rows3,
  sidebarClose: PanelLeftClose,
  sidebarOpen: PanelLeftOpen,
  emoji: Smile,
  text: Type,
  callout: Lightbulb,
  grip: GripVertical,
  folder: Folder,
  folderOpen: FolderOpen,
  assistant: Wand,
  external: ArrowUpRight,
  openExternal: ExternalLink,
  restore: RotateCcw,
  minimize: Minus,
  maximize: Square,
  unmaximize: Restore,
  bell: Bell,
  attachment: Paperclip,
  play: Play,
  pause: Pause,
  info: Info,
  warning: TriangleAlert,
  success: CircleCheck,
  error: CircleX,
  loading: Loader,
  disconnected: Unplug,
  server: Server,
  monitor: Monitor,
  keyboard: Keyboard,
  storage: Database,
  language: Languages,
  appearance: Palette,
  layers: Layers,
  inbox: Inbox,
  alignLeft: AlignLeft,
  alignCenter: AlignCenter,
  alignRight: AlignRight,
  refresh: RefreshCw,
  sliders: SlidersHorizontal,
  repeat: Repeat,
  announce: Megaphone,
  shield: ShieldCheck,
  command: Command,
  square: Square,
  expand: Expand,
  arrowUp: ArrowUp,
  mic: Mic,
} satisfies Record<string, IconComp>;

export type IconName = keyof typeof REGISTRY;

export interface IconProps {
  name: IconName;
  size?: number;
  /** Optical weight: thinner as icons grow, so large and small read alike. */
  weight?: number;
  className?: string;
  style?: CSSProperties;
  label?: string;
  /** Solid variant for "on" states (pinned, favourite, selected). */
  filled?: boolean;
}

export function Icon({ name, size = 16, weight, className = "", style, label, filled }: IconProps) {
  const Comp = REGISTRY[name] as IconComp;
  // Optical weights in the SF Symbols "medium" range: small glyphs get a heavier
  // stroke so every size reads with the same visual weight.
  // One optical weight for the whole set (SF Symbols "regular" feel): the
  // stroke scales with the square root of size, so 14px and 22px glyphs read
  // equally heavy. Lucide's 24px grid is the reference (1.6 at 20px).
  const stroke = weight ?? Math.round(1.6 * Math.sqrt(20 / Math.max(10, size)) * 100) / 100;
  return (
    <Comp
      size={size}
      strokeWidth={stroke}
      fill={filled ? "currentColor" : "none"}
      className={`icon ${filled ? "is-filled" : ""} ${className}`}
      style={style}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  );
}
