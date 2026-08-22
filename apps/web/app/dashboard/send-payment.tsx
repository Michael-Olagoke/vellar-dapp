"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { Network } from "@vellar/types";
import {
  formatTokenAmount,
  parseTokenAmount,
  type PreparedPayment,
  type TokenInfo,
} from "vellar-sdk";
import { isUserCancellation } from "@vellar/passkey";
import { Eyebrow, LpActionButton } from "@/app/landing/ui";
import { walletErrorMessage } from "@/lib/messages";
import { trackTransaction } from "@/lib/track";
import { usePaymentClient } from "@/lib/wallet-context";

// Send flow (technical-doc.md §7.4): build -> explicit review -> passkey sign
// -> submit -> track until final. Signing only ever happens from the review
// step after the user clicks confirm — no silent signing (§8).

const formSchema = z.object({
  to: z.string().trim().min(1, "Recipient is required"),
  amount: z.string().trim().min(1, "Amount is required"),
});

type FormValues = z.infer<typeof formSchema>;

type FlowState =
  | { step: "form" }
  | { step: "review"; prepared: PreparedPayment }
  | { step: "submitting"; prepared: PreparedPayment }
  | { step: "tracking"; hash: string }
  | { step: "done"; hash: string; result: "success" | "failed" };

export function SendPayment({
  from,
  token,
  network,
  onSuccess,
}: {
  from: string;
  token: TokenInfo;
  network: Network;
  onSuccess: () => void;
}) {
  const getPayments = usePaymentClient();
  const [flow, setFlow] = useState<FlowState>({ step: "form" });
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { to: "", amount: "" },
  });

  async function prepare(values: FormValues) {
    setError(null);
    try {
      const amount = parseTokenAmount(values.amount, token.decimals);
      const payments = await getPayments();
      const prepared = await payments.preparePayment({ from, to: values.to, token, amount });
      setFlow({ step: "review", prepared });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't prepare the payment.");
    }
  }

  async function confirm(prepared: PreparedPayment) {
    setFlow({ step: "submitting", prepared });
    setError(null);
    let hash: string;
    try {
      ({ hash } = await prepared.confirm());
    } catch (err) {
      if (isUserCancellation(err)) {
        // Changing your mind at the passkey prompt returns you to review.
        setFlow({ step: "review", prepared });
      } else {
        // Surface the raw failure for diagnostics; the user sees mapped copy.
        console.error("payment confirm failed", err);
        setError(walletErrorMessage(err));
        setFlow({ step: "review", prepared });
      }
      return;
    }

    setFlow({ step: "tracking", hash });
    try {
      const result = await trackTransaction(hash);
      setFlow({ step: "done", hash, result });
      if (result === "success") {
        form.reset();
        onSuccess();
      }
    } catch {
      setError("The network hasn't confirmed the transaction yet. Check again shortly.");
      setFlow({ step: "done", hash, result: "failed" });
    }
  }

  return (
    <section className="lpa-panel">
      <Eyebrow>Send {token.symbol}</Eyebrow>

      {flow.step === "form" && (
        <form
          onSubmit={(e) => void form.handleSubmit(prepare)(e)}
          className="mt-3.5 flex flex-col gap-3"
        >
          <label className="lpa-field">
            <span className="flabel">Recipient</span>
            <input {...form.register("to")} placeholder="G... or C..." />
            {form.formState.errors.to && (
              <span className="ferror">{form.formState.errors.to.message}</span>
            )}
          </label>
          <label className="lpa-field">
            <span className="flabel">Amount ({token.symbol})</span>
            <input {...form.register("amount")} placeholder="0.0" inputMode="decimal" />
            {form.formState.errors.amount && (
              <span className="ferror">{form.formState.errors.amount.message}</span>
            )}
          </label>
          <LpActionButton
            type="submit"
            disabled={form.formState.isSubmitting}
            className="self-start"
          >
            {form.formState.isSubmitting ? "Preparing…" : "Review payment"}
          </LpActionButton>
        </form>
      )}

      {(flow.step === "review" || flow.step === "submitting") && (
        <div role="dialog" aria-label="Review payment" className="mt-3.5 flex flex-col gap-3">
          <span className="lpa-ok self-start text-[13px] font-bold">
            ✓ Review before signing — this cannot be undone
          </span>
          <dl className="lpa-well flex flex-col gap-2.5 text-sm">
            {(
              [
                ["From", flow.prepared.review.from],
                ["To", flow.prepared.review.to],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-[var(--lp-ink-faint)]">{label}</dt>
                <dd className="break-all text-right font-[family-name:var(--lp-mono)] text-xs">
                  {value}
                </dd>
              </div>
            ))}
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--lp-ink-faint)]">Amount</dt>
              <dd className="lpa-amt text-xl">
                {formatTokenAmount(
                  flow.prepared.review.amount,
                  flow.prepared.review.token.decimals,
                )}{" "}
                {flow.prepared.review.token.symbol}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--lp-ink-faint)]">Network</dt>
              <dd className="uppercase">{flow.prepared.review.network}</dd>
            </div>
          </dl>
          <div className="flex gap-3">
            <LpActionButton
              onClick={() => void confirm(flow.prepared)}
              disabled={flow.step === "submitting"}
            >
              {flow.step === "submitting" ? "Signing…" : "Confirm with passkey"}
            </LpActionButton>
            <LpActionButton
              variant="outline"
              onClick={() => setFlow({ step: "form" })}
              disabled={flow.step === "submitting"}
            >
              Cancel
            </LpActionButton>
          </div>
        </div>
      )}

      {flow.step === "tracking" && (
        <p className="mt-3.5! animate-pulse text-sm text-[var(--lp-ink-soft)]">
          Confirming on the network…{" "}
          <span className="break-all font-[family-name:var(--lp-mono)]">{flow.hash}</span>
        </p>
      )}

      {flow.step === "done" && (
        <div className="mt-3.5 flex flex-col gap-2 text-sm">
          <p className={flow.result === "success" ? "lpa-ok" : "lpa-bad"}>
            {flow.result === "success" ? "Payment confirmed." : "Payment failed on the network."}
          </p>
          <p className="break-all font-[family-name:var(--lp-mono)] text-xs text-[var(--lp-ink-faint)]">
            {flow.hash}
          </p>
          <LpActionButton
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setFlow({ step: "form" })}
          >
            Send another
          </LpActionButton>
        </div>
      )}

      {error && (
        <p role="alert" className="lpa-bad mt-3.5! text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
