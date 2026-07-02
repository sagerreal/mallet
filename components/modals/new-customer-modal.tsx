/**
 * components/modals/new-customer-modal.tsx
 * Port of ovQuick / openQuickAdd (§5.9).
 * Name + phone + job inputs, source picker, Person/Biz toggle.
 * Create → store.addLead → appears in list → modal closes.
 */

"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "./modal";
import { useCloseModal, useAppStore } from "@/lib/store/app-store";
import { SAMPLE_BRAND } from "@/lib/prototype-sample";

const SOURCES = [
  "Google",
  "Referral",
  "Nextdoor / FB",
  "Repeat customer",
  "Yard sign",
  "Angi",
  "Thumbtack",
  "Yelp",
];

export function NewCustomerModal({ open }: { open: boolean }) {
  const close = useCloseModal();
  const addLead = useAppStore((s) => s.addLead);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [job, setJob] = useState("");
  const [source, setSource] = useState("");
  const [isBiz, setIsBiz] = useState(false);
  const [bizName, setBizName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setPhone("");
    setJob("");
    setSource("");
    setIsBiz(false);
    setBizName("");
    setError(null);
  }

  function handleClose() {
    reset();
    close();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    addLead({
      name: name.trim(),
      phone: phone.trim(),
      job: job.trim() || "New customer",
      source: source || "Direct",
      stage: "New customer",
      companyId: undefined,
      role: isBiz && bizName ? "Contact" : undefined,
    });
    reset();
    close();
  }

  return (
    <Modal open={open} onClose={handleClose}>
      <h2>New customer</h2>
      <p className="muted" style={{ marginBottom: 20 }}>
        Add someone to {SAMPLE_BRAND.name}&apos;s pipeline.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Person / Biz toggle */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={`btn sm${!isBiz ? " primary" : " ghost"}`}
            onClick={() => setIsBiz(false)}
          >
            Person
          </button>
          <button
            type="button"
            className={`btn sm${isBiz ? " primary" : " ghost"}`}
            onClick={() => setIsBiz(true)}
          >
            Business
          </button>
        </div>

        {/* Name */}
        <div className="field">
          <label>Name *</label>
          <input
            type="text"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        {/* Business name (biz only) */}
        {isBiz && (
          <div className="field">
            <label>Business name</label>
            <input
              type="text"
              placeholder="Company or business"
              value={bizName}
              onChange={(e) => setBizName(e.target.value)}
            />
          </div>
        )}

        {/* Phone */}
        <div className="field">
          <label>Phone</label>
          <input
            type="tel"
            placeholder="(925) 555-0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        {/* Job / what&apos;s needed */}
        <div className="field">
          <label>What&apos;s needed?</label>
          <input
            type="text"
            placeholder="e.g. Water heater replacement"
            value={job}
            onChange={(e) => setJob(e.target.value)}
          />
        </div>

        {/* Source picker */}
        <div className="field">
          <label>Source</label>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Choose…</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button type="submit" className="btn primary">
            Create
          </button>
          <button type="button" className="btn ghost" onClick={handleClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
