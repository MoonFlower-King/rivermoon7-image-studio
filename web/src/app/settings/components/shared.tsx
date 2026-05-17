"use client";

import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { ConfigPayload } from "@/lib/api";

export type SetConfigSection = <K extends keyof ConfigPayload>(
  section: K,
  nextValue: ConfigPayload[K],
) => void;

export type TooltipDetail = {
  title: string;
  body: ReactNode;
};

export function HintTooltip({ content }: { content: ReactNode }) {
  return (
    <span className="group relative inline-flex items-center align-middle">
      <span
        tabIndex={0}
        className="inline-flex size-4 cursor-help items-center justify-center rounded-full text-stone-400 transition-colors hover:text-stone-700 focus-visible:text-stone-700 focus-visible:outline-none"
        aria-label="查看配置说明"
      >
        <CircleHelp className="size-4" />
      </span>
      <span className="pointer-events-none absolute top-full left-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-stone-200 bg-white px-4 py-3 text-xs font-normal leading-6 text-stone-600 opacity-0 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)] transition-all duration-200 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100">
        {content}
      </span>
    </span>
  );
}

export function LabelWithHint({
  label,
  tooltip,
}: {
  label: ReactNode;
  tooltip?: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      {tooltip ? <HintTooltip content={tooltip} /> : null}
    </span>
  );
}

export function TooltipDetails({ items }: { items: TooltipDetail[] }) {
  return (
    <>
      {items.map((item, index) => (
        <div key={`${item.title}-${index}`} className={index === 0 ? "" : "mt-2"}>
          <span className="font-semibold text-stone-800">{item.title}：</span>
          {item.body}
        </div>
      ))}
    </>
  );
}

export function ConfigSection({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="border-stone-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.05)]">
      <CardContent className="space-y-4 p-4 sm:space-y-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight text-stone-900 sm:text-base">{title}</div>
            <p className="mt-0.5 text-xs leading-5 text-stone-500 sm:mt-1 sm:text-sm sm:leading-6">{description}</p>
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2">{actions}</div> : null}
        </div>
        <div className="grid gap-3 md:grid-cols-2 md:gap-4">{children}</div>
      </CardContent>
    </Card>
  );
}

export function Field({
  label,
  hint,
  tooltip,
  children,
  fullWidth = false,
}: {
  label: ReactNode;
  hint: string;
  tooltip?: ReactNode;
  children: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <label className={fullWidth ? "space-y-1.5 md:col-span-2 sm:space-y-2" : "space-y-1.5 sm:space-y-2"}>
      <div className="text-[13px] font-medium text-stone-700 sm:text-sm">
        <LabelWithHint label={label} tooltip={tooltip ?? hint} />
      </div>
      <div>{children}</div>
      <div className="hidden text-xs leading-5 text-stone-400 sm:block">{hint}</div>
    </label>
  );
}

export function ToggleField({
  label,
  hint,
  tooltip,
  checked,
  onCheckedChange,
}: {
  label: ReactNode;
  hint: string;
  tooltip?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3 md:col-span-2 sm:p-4">
      <div className="flex items-start gap-2.5 sm:gap-3">
        <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(Boolean(value))} />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-stone-700 sm:text-sm">
            <LabelWithHint label={label} tooltip={tooltip ?? hint} />
          </div>
          <div className="mt-1 hidden text-xs leading-5 text-stone-400 sm:block">{hint}</div>
        </div>
      </div>
    </div>
  );
}
