"use client";
import {
  ArrowLeft, ArrowsClockwise, ArrowsOut, Bell, BookOpen, CaretRight,
  ChartLine, ClipboardText, Desktop, Devices, Folder, GameController,
  GearSix, House, Info, Keyboard, Link, Lock, MagnifyingGlassPlus,
  Moon, Plus, Power, ShieldCheck, DeviceMobile, SpeakerHigh, SquaresFour,
  Sun, VideoCamera, X, type Icon,
} from "@phosphor-icons/react";

const icons = {
  back: ArrowLeft, refresh: ArrowsClockwise, expand: ArrowsOut, bell: Bell,
  novel: BookOpen, next: CaretRight, stats: ChartLine, clipboard: ClipboardText,
  desktop: Desktop, devices: Devices, files: Folder, game: GameController,
  settings: GearSix, home: House, info: Info, keyboard: Keyboard, link: Link,
  lock: Lock, zoom: MagnifyingGlassPlus, moon: Moon, plus: Plus, power: Power,
  shield: ShieldCheck, phone: DeviceMobile, audio: SpeakerHigh, recents: SquaresFour,
  sun: Sun, record: VideoCamera, close: X,
} satisfies Record<string, Icon>;
export type UiIconName = keyof typeof icons;
export default function UiIcon({ name, size = 20 }: { name: UiIconName; size?: number }) {
  const Symbol = icons[name];
  return <Symbol size={size} weight="light" aria-hidden="true" focusable="false" />;
}
