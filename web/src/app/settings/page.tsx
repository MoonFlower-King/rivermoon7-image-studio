"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/api";
import { getStoredAuthKey, setStoredAuthKey } from "@/store/auth";

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getStoredAuthKey().then((value) => {
      if (!cancelled) {
        setApiKey(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    const normalized = apiKey.trim();
    if (!normalized) {
      toast.error("请输入 NewAPI key");
      return;
    }

    setIsSaving(true);
    try {
      await login(normalized);
      await setStoredAuthKey(normalized);
      toast.success("已验证 image2.0，并保存到本机浏览器");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "验证失败");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 items-center justify-center overflow-y-auto">
      <div className="w-full max-w-[760px] rounded-[30px] border border-stone-200 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.06)] dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)] sm:p-8">
        <div className="flex items-start gap-4">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white dark:bg-[var(--studio-accent-strong)] dark:text-[var(--studio-accent-foreground)]">
            <KeyRound className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-[var(--studio-text-strong)]">
              本地设置
            </h1>
            <p className="mt-2 text-sm leading-7 text-stone-500 dark:text-[var(--studio-text-muted)]">
              这里仅保存你的 NewAPI key 到当前浏览器本地，用于调用 image2.0。密钥不会写入服务器，也不会暴露后台管理能力。
            </p>
          </div>
        </div>

        <div className="mt-8 space-y-3">
          <label htmlFor="newapi-key" className="block text-sm font-medium text-stone-700 dark:text-[var(--studio-text)]">
            NewAPI key
          </label>
          <Input
            id="newapi-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk-..."
            className="h-12 rounded-2xl border-stone-200 bg-stone-50 px-4 shadow-none focus-visible:ring-1 dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)]"
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-[var(--studio-panel-soft)] dark:text-[var(--studio-text)]">
            <CheckCircle2 className="size-4" />
            验证接口：/v1/models · 模型：image2.0
          </div>
          <Button
            className="h-10 rounded-full bg-stone-950 px-5 text-white hover:bg-stone-800 dark:bg-[var(--studio-accent-strong)] dark:text-[var(--studio-accent-foreground)]"
            disabled={isSaving}
            onClick={() => void handleSave()}
          >
            {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : null}
            保存并验证
          </Button>
        </div>
      </div>
    </section>
  );
}
