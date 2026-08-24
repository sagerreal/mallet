"use client";

/**
 * features/field/my-hours-add-time-off.tsx
 * "Add time off" — the entry path the add-hours form has always pointed at and nobody had built.
 *
 * WHY IT IS A SEPARATE FORM. A time-off row is a different SHAPE, not a fifth kind on the Type
 * control: the schema's time_entries_kind_shape_check demands a length and forbids punch times,
 * so a PTO chip beside Job/Regular/Break would sit above a Start and an End the row may not carry.
 * Worse if it were forced through — a sick day entered as 08:00–16:00 becomes eight hours of
 * WORKED time, which is what the overlap gate and the overtime threshold both read. Someone who
 * took Tuesday off and worked thirty-six real hours would be paid overtime.
 *
 * Full day comes from the shop's own configured hours (v1.field.standardDay: this person's crew
 * row, else the org's day hours), never a compiled-in eight — see time-off-amount.ts.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, useGroupLabel } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { api } from "@/lib/trpc/client";
import { dayLabel } from "./my-hours-derive";
import { editWindowDates } from "./my-hours-edit";
import {
  timeOffMinutes,
  amountProblem,
  HALF_DAY_DIVISOR,
  type TimeOffAmount,
} from "./time-off-amount";
import type { AddTimeOffInput } from "./use-my-hours-writes";

type Kind = AddTimeOffInput["kind"];

/** Sick and PTO lead: they are the two a technician records about himself, and the common case. */
const KINDS: readonly Kind[] = ["pto", "sick", "vacation", "holiday"];

const KIND_LABELS: Record<Kind, string> = {
  pto: "PTO",
  sick: "Sick",
  vacation: "Vacation",
  holiday: "Holiday",
};

const AMOUNTS: readonly TimeOffAmount[] = ["full", "half", "custom"];

const MINUTES_PER_HOUR = 60;

/** "8h" / "7h 30m" — how the shop's own standard reads back, so Full day is never a mystery. */
const lengthLabel = (minutes: number): string => {
  const h = Math.floor(minutes / MINUTES_PER_HOUR);
  const m = minutes % MINUTES_PER_HOUR;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

function Segmented<T extends string>({
  options,
  value,
  onPick,
  labels,
}: {
  options: readonly T[];
  value: T;
  onPick: (next: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <div className="ts-seg">
      {options.map((option) => (
        <button
          key={option}
          className={value === option ? "on" : ""}
          aria-pressed={value === option}
          onClick={() => onPick(option)}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

/**
 * The Amount control and, when it is needed, the hours box under it.
 *
 * Its own component so the form stays readable and so the LABELS live next to the arithmetic that
 * produces them: "Full day (7h 30m)" is the shop's configured day read back, which is the only
 * thing that makes a segmented control trustworthy on a screen about someone's pay.
 */
function AmountRow({
  amount,
  onPick,
  standardMinutes,
  customHours,
  onCustomHours,
}: {
  amount: TimeOffAmount;
  onPick: (next: TimeOffAmount) => void;
  /** Null while the shop has not answered, or on a day it has as off — then no length is named. */
  standardMinutes: number | null;
  customHours: string;
  onCustomHours: (next: string) => void;
}) {
  const group = useGroupLabel();
  const named = (label: string, minutes: number | null): string =>
    minutes === null ? label : `${label} (${lengthLabel(minutes)})`;

  const labels: Record<TimeOffAmount, string> = {
    full: named("Full day", standardMinutes),
    half: named("Half day", standardMinutes === null ? null : Math.round(standardMinutes / HALF_DAY_DIVISOR)),
    custom: "Hours",
  };

  return (
    <>
      <div className="ts-erow" {...group.groupProps}>
        <label {...group.labelProps}>Amount</label>
        <Segmented options={AMOUNTS} value={amount} onPick={onPick} labels={labels} />
      </div>
      {amount === "custom" ? (
        <Field label="Hours">
          <input
            type="number"
            inputMode="decimal"
            min={0.25}
            max={24}
            step={0.25}
            value={customHours}
            onChange={(e) => onCustomHours(e.target.value)}
          />
        </Field>
      ) : null}
    </>
  );
}

export interface AddTimeOffFormProps {
  readonly today: string;
  readonly techUserId: string | undefined;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onAdd: (input: AddTimeOffInput, onDone: () => void) => void;
  readonly onCancel: () => void;
}

export function AddTimeOffForm({
  today,
  techUserId,
  saving,
  error,
  onAdd,
  onCancel,
}: AddTimeOffFormProps) {
  const [workDate, setWorkDate] = useState(today);
  const [kind, setKind] = useState<Kind>("pto");
  const [amount, setAmount] = useState<TimeOffAmount>("full");
  const [customHours, setCustomHours] = useState("");
  const [note, setNote] = useState("");
  const kindGroup = useGroupLabel();

  // The shop's answer for THE CHOSEN DATE — it changes with the day (a Saturday, a part-timer's
  // Friday), so it is keyed on workDate rather than read once for today.
  const standard = api.v1.field.standardDay.useQuery({ date: workDate });
  const standardMinutes = standard.data?.minutes ?? null;

  // Until the shop has answered, "Full day" has no length. Saying nothing beats guessing eight
  // hours and beats flashing "this is a day off" at someone whose query simply has not landed.
  const standardKnown = standard.isSuccess;

  const args = { amount, standardMinutes, customHours };
  const minutes = timeOffMinutes(args);
  const problem = standardKnown || amount === "custom" ? amountProblem(args) : null;
  const ready = techUserId !== undefined && minutes !== null && problem === null;

  const submit = (): void => {
    if (techUserId === undefined || minutes === null || problem !== null) return;
    onAdd({ techUserId, workDate, kind, minutes, note: note.trim() }, () => {
      setCustomHours("");
      setNote("");
      onCancel();
    });
  };

  return (
    <div className="ts-editor">
      <Field label="Day">
        <SelectMenu
          value={workDate}
          onChange={setWorkDate}
          options={editWindowDates(today).map((date) => ({ value: date, label: dayLabel(date) }))}
          aria-label="Time off date"
          compact
        />
      </Field>
      <div className="ts-erow" {...kindGroup.groupProps}>
        <label {...kindGroup.labelProps}>Type</label>
        <Segmented options={KINDS} value={kind} onPick={setKind} labels={KIND_LABELS} />
      </div>
      <AmountRow
        amount={amount}
        onPick={setAmount}
        standardMinutes={standardKnown ? standardMinutes : null}
        customHours={customHours}
        onCustomHours={setCustomHours}
      />
      <Field label="Note (optional)">
        <input type="text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {problem !== null ? <p className="mh-err">{problem}</p> : null}
      {error !== null ? <p className="mh-err">{error}</p> : null}
      <div className="mh-acts">
        <Button disabled={!ready || saving} onClick={submit}>
          {saving ? "Adding…" : "Add this time off"}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
