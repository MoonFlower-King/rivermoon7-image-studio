"use client";

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleAlert, LoaderCircle, LockKeyhole, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/api";
import { setStoredAuthKey } from "@/store/auth";

export default function LoginPage() {
  const navigate = useNavigate();
  const [authKey, setAuthKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async () => {
    const normalizedAuthKey = authKey.trim();
    if (!normalizedAuthKey) {
      toast.error("请输入 NewAPI key");
      return;
    }

    setIsSubmitting(true);
    try {
      await login(normalizedAuthKey);
      await setStoredAuthKey(normalizedAuthKey);
      navigate("/image", { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "登录失败";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid h-full min-h-0 w-full place-items-center overflow-y-auto">
      <div className="grid w-full max-w-[1120px] overflow-hidden rounded-[32px] border border-stone-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)] lg:grid-cols-[1.05fr_0.95fr]">
        <div className="hidden bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.78),_rgba(255,255,255,0.18)_38%,_rgba(28,25,23,0.08)_100%),linear-gradient(155deg,#111827_0%,#1f2937_52%,#374151_100%)] p-8 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-white/12 backdrop-blur">
              <Sparkles className="size-4" />
            </span>
            <div>
              <div className="text-sm font-semibold tracking-tight">Rivermoon Image Studio</div>
              <div className="mt-1 text-xs text-white/65">image2.0 图片生成与编辑工作区</div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-3">
              <div className="text-sm font-medium uppercase tracking-[0.24em] text-white/55">Image Studio</div>
              <h1 className="max-w-[420px] text-[40px] font-semibold leading-[1.1] tracking-tight">
                在一个界面里完成生成、编辑与本机历史。
              </h1>
              <p className="max-w-[430px] text-sm leading-7 text-white/72">
                输入你的 NewAPI key 后直接进入图片工作台。请求只调用 image2.0，并按该用户的钱包额度计费。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["生成", "从提示词或参考图开始"],
                ["编辑", "继续改图，保留上下文"],
                ["历史", "浏览器本地保存记录"],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-2xl border border-white/12 bg-white/6 p-4 backdrop-blur-sm">
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="mt-2 text-xs leading-6 text-white/65">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-white/50">密钥只保存在当前浏览器本地，不注入服务器后台密钥。</div>
        </div>

        <div className="flex items-center justify-center px-5 py-8 sm:px-8 lg:px-10">
          <div className="w-full max-w-[420px] space-y-8">
            <div className="space-y-4">
              <div className="inline-flex size-14 items-center justify-center rounded-[18px] bg-stone-950 text-white shadow-sm">
                <LockKeyhole className="size-5" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-stone-950">进入图片工作区</h1>
                <p className="text-sm leading-7 text-stone-500">
                  输入你的 NewAPI key，验证 image2.0 可用后开始生成。
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <label htmlFor="auth-key" className="block text-sm font-medium text-stone-700">
                NewAPI key
              </label>
              <Input
                id="auth-key"
                type="password"
                value={authKey}
                onChange={(event) => setAuthKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleLogin();
                  }
                }}
                placeholder="sk-..."
                className="h-13 rounded-2xl border-stone-200 bg-stone-50 px-4 shadow-none focus-visible:ring-1"
              />
            </div>

            <Button
              className="h-13 w-full rounded-2xl bg-stone-950 text-white hover:bg-stone-800"
              onClick={() => void handleLogin()}
              disabled={isSubmitting}
            >
              {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              验证并进入
            </Button>

            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-xs leading-6 text-stone-500">
              本页面只验证 `/v1/models` 是否可见 `image2.0`，不会读取或展示你的密钥。
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950">
              <div className="flex items-center gap-2 font-medium">
                <CircleAlert className="size-4" />
                使用与风险提示
              </div>
              <div className="mt-2">
                请确认你使用的是自己的 NewAPI key。所有图片生成和编辑都会按该 NewAPI 用户钱包计费。
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
