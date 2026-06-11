"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  MinusCircle,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  getUnmaskedProviderKey,
  testProviderGemini,
  testProviderUnified,
} from "@/lib/api-client/v1/actions/providers";
import {
  type BatchTestItemStatus,
  runBatchWithConcurrency,
  summarizeBatchTestStatuses,
} from "@/lib/provider-testing/batch-runner";
import {
  getDefaultTestTimeoutMs,
  resolveDefaultTestModel,
} from "@/lib/provider-testing/client-defaults";
import type { TestStatus } from "@/lib/provider-testing/types";
import type { ProviderDisplay } from "@/types/provider";
import type { UnifiedTestResultData } from "../forms/test-result-card";

const BATCH_TEST_CONCURRENCY = 5;

interface BatchTestOutcome {
  status: TestStatus;
  latencyMs?: number;
  model?: string;
  message?: string;
}

interface BatchTestItem {
  provider: ProviderDisplay;
  status: BatchTestItemStatus;
  latencyMs?: number;
  model?: string;
  message?: string;
}

/** Gemini 测试接口返回结构（见 actions/providers.ts ProviderApiTestResult） */
interface GeminiTestResponseData {
  success?: boolean;
  message?: string;
  details?: {
    responseTime?: number;
    model?: string;
  };
}

export interface ProviderBatchTestDialogProps {
  providers: ProviderDisplay[];
  onClose: () => void;
}

export function ProviderBatchTestDialog({ providers, onClose }: ProviderBatchTestDialogProps) {
  const t = useTranslations("settings.providers.batchTest");
  const [items, setItems] = useState<BatchTestItem[]>(() =>
    providers.map((provider) => ({ provider, status: "pending" as const }))
  );
  const [isRunning, setIsRunning] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelledRef = useRef(false);
  const startedRef = useRef(false);

  const updateItem = useCallback((index: number, patch: Partial<BatchTestItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }, []);

  const startRun = useCallback(async () => {
    cancelledRef.current = false;
    setCancelRequested(false);
    setIsRunning(true);
    setItems(providers.map((provider) => ({ provider, status: "pending" as const })));

    const failedOutcome = (message: string): BatchTestOutcome => ({ status: "red", message });

    const executeOne = async (provider: ProviderDisplay): Promise<BatchTestOutcome> => {
      try {
        const keyResult = await getUnmaskedProviderKey(provider.id);
        if (!keyResult.ok) {
          return failedOutcome(keyResult.error || t("errors.keyFetchFailed"));
        }
        const apiKey = keyResult.data?.key;
        if (!apiKey) {
          return failedOutcome(t("errors.keyFetchFailed"));
        }

        const model = resolveDefaultTestModel(provider.providerType, provider.allowedModels);
        const timeoutMs = getDefaultTestTimeoutMs(provider.providerType);

        if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
          const response = await testProviderGemini({
            providerUrl: provider.url,
            apiKey,
            model,
            proxyUrl: provider.proxyUrl,
            proxyFallbackToDirect: provider.proxyFallbackToDirect,
            timeoutMs,
          });
          if (!response.ok) {
            return failedOutcome(response.error || t("errors.testFailed"));
          }
          const data = response.data as GeminiTestResponseData | undefined;
          if (!data) {
            return failedOutcome(t("errors.noResult"));
          }
          const rawMessage = data.message || "";
          const usedFallback = rawMessage.includes("[FALLBACK:URL_PARAM]");
          const success = data.success === true;
          return {
            status: success ? (usedFallback ? "yellow" : "green") : "red",
            latencyMs: data.details?.responseTime,
            model: data.details?.model,
            message: rawMessage.replace(" [FALLBACK:URL_PARAM]", "") || undefined,
          };
        }

        const response = await testProviderUnified({
          providerUrl: provider.url,
          apiKey,
          providerType: provider.providerType,
          model,
          proxyUrl: provider.proxyUrl,
          proxyFallbackToDirect: provider.proxyFallbackToDirect,
          timeoutMs,
          customHeaders: provider.customHeaders ?? undefined,
        });
        if (!response.ok) {
          return failedOutcome(response.error || t("errors.testFailed"));
        }
        const data = response.data as UnifiedTestResultData | undefined;
        if (!data) {
          return failedOutcome(t("errors.noResult"));
        }
        return {
          status: data.status,
          latencyMs: data.latencyMs,
          model: data.model,
          message: data.errorMessage || data.message,
        };
      } catch (error) {
        return failedOutcome(error instanceof Error ? error.message : t("errors.testFailed"));
      }
    };

    await runBatchWithConcurrency(providers, executeOne, {
      concurrency: BATCH_TEST_CONCURRENCY,
      isCancelled: () => cancelledRef.current,
      onItemStart: (_, index) => updateItem(index, { status: "running" }),
      onItemSettled: (_, index, outcome) => updateItem(index, { ...outcome }),
    });

    // 取消后未启动的条目标记为跳过
    setItems((prev) =>
      prev.map((item) =>
        item.status === "pending" || item.status === "running"
          ? { ...item, status: "skipped" }
          : item
      )
    );
    setIsRunning(false);
  }, [providers, t, updateItem]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void startRun();
  }, [startRun]);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    setCancelRequested(true);
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      cancelledRef.current = true;
      onClose();
    },
    [onClose]
  );

  const summary = useMemo(
    () => summarizeBatchTestStatuses(items.map((item) => item.status)),
    [items]
  );
  const completed = summary.finished + summary.skipped;
  const progressPercent = summary.total > 0 ? (completed / summary.total) * 100 : 100;

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[var(--cch-viewport-height-85)] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("dialog.title")}</DialogTitle>
          <DialogDescription>
            {isRunning
              ? t("dialog.runningDesc", { count: summary.total })
              : t("dialog.doneDesc", { count: summary.total })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground tabular-nums">
              {t("dialog.progress", { completed, total: summary.total })}
            </span>
            <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
              <span className="text-green-600 dark:text-green-400">
                {t("status.green")} {summary.green}
              </span>
              {summary.yellow > 0 && (
                <span className="text-yellow-600 dark:text-yellow-400">
                  {t("status.yellow")} {summary.yellow}
                </span>
              )}
              <span className="text-red-600 dark:text-red-400">
                {t("status.red")} {summary.red}
              </span>
              {summary.skipped > 0 && (
                <span className="text-muted-foreground">
                  {t("status.skipped")} {summary.skipped}
                </span>
              )}
            </div>
          </div>
          <Progress value={progressPercent} />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
          {items.map((item) => (
            <BatchTestItemRow key={item.provider.id} item={item} />
          ))}
        </div>

        <DialogFooter>
          {isRunning ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={cancelRequested}
            >
              {cancelRequested ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-2 h-4 w-4" />
              )}
              {t("buttons.cancel")}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => void startRun()}>
                <RotateCcw className="mr-2 h-4 w-4" />
                {t("buttons.retest")}
              </Button>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                {t("buttons.close")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_ICONS: Record<BatchTestItemStatus, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
  skipped: <MinusCircle className="h-4 w-4 text-muted-foreground" />,
  green: <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />,
  yellow: <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />,
  red: <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />,
};

const STATUS_TEXT_CLASSES: Record<BatchTestItemStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-primary",
  skipped: "text-muted-foreground",
  green: "text-green-600 dark:text-green-400",
  yellow: "text-yellow-600 dark:text-yellow-400",
  red: "text-red-600 dark:text-red-400",
};

function BatchTestItemRow({ item }: { item: BatchTestItem }) {
  const t = useTranslations("settings.providers.batchTest");

  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <div className="mt-0.5 shrink-0">{STATUS_ICONS[item.status]}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{item.provider.name}</span>
          <Badge variant="outline" className="text-xs">
            {item.provider.providerType}
          </Badge>
          {item.model && (
            <span className="truncate text-xs text-muted-foreground">{item.model}</span>
          )}
          {item.latencyMs !== undefined && (
            <span className="text-xs text-muted-foreground tabular-nums">{item.latencyMs}ms</span>
          )}
        </div>
        {item.message && (
          <p
            className="mt-1 break-all text-xs text-muted-foreground line-clamp-2"
            title={item.message}
          >
            {item.message}
          </p>
        )}
      </div>
      <span className={`shrink-0 text-xs font-medium ${STATUS_TEXT_CLASSES[item.status]}`}>
        {t(`status.${item.status}`)}
      </span>
    </div>
  );
}
