/**
 * demoData.ts — built-in sample so the whole app works with ZERO setup.
 *
 * Used automatically when there is no GNANI_API_KEY (or DEMO_MODE=true).
 * It is a made-up Hinglish conversation between Ramesh and Suresh that
 * contains one clear promise, one vague promise and two risky ones.
 */
import type { Analysis } from "./analysis";

export const DEMO_TRANSCRIPT = `Ramesh: Suresh bhai, main tumhe bees hazaar rupaye de raha hoon, aaj hi.
Suresh: Haan Ramesh, bahut shukriya. Main 15 December tak poore paise wapas kar dunga.
Ramesh: Theek hai. Aur har mahine do hazaar rupaye kharcha alag se dena padega. Yeh baat kisi ko batana mat.
Suresh: Haan haan, theek hai. Pehle paanch hazaar main jaldi de dunga.
Ramesh: Jab tak paisa wapas nahi aata, tumhari scooter ke kagaz mere paas rahenge. Koi receipt nahi milegi.`;

export const DEMO_ANALYSIS: Analysis = {
  language: "hi-en",
  parties: ["Ramesh", "Suresh"],
  promises: [
    {
      id: 1,
      who: "Ramesh",
      to: "Suresh",
      what: "Give ₹20,000 in cash today",
      amount: 20000,
      due: "Today",
      risk: "green",
      reason: "The amount and the day are both clear, and both of you agreed.",
    },
    {
      id: 2,
      who: "Suresh",
      to: "Ramesh",
      what: "Repay ₹20,000",
      amount: 20000,
      due: "15 Dec",
      risk: "green",
      reason: "A clear amount with a fixed date. Easy to check later.",
    },
    {
      id: 3,
      who: "Suresh",
      to: "Ramesh",
      what: "Pay the first ₹5,000 “jaldi”",
      amount: 5000,
      due: "Not fixed (“jaldi”)",
      risk: "amber",
      reason: "“Jaldi” means “soon”, but no day was said. Agree on one date so there is no fight later.",
    },
    {
      id: 4,
      who: "Suresh",
      to: "Ramesh",
      what: "Pay ₹2,000 “kharcha” every month",
      amount: 2000,
      due: "Every month, no end date",
      risk: "red",
      reason:
        "This is hidden interest: ₹2,000 a month on ₹20,000 is 10% every month. There is no end date, and Suresh was asked to keep it secret.",
    },
    {
      id: 5,
      who: "Ramesh",
      to: "Suresh",
      what: "Keep Suresh's scooter papers until repaid",
      amount: null,
      due: "Until repaid",
      risk: "red",
      reason:
        "One-sided: Ramesh holds the papers but gives no receipt and does not promise to return them on time.",
    },
  ],
  summary:
    "Ramesh is lending Suresh ₹20,000 today, to be repaid by 15 December. But there is also a hidden ₹2,000 monthly charge, and Ramesh keeps the scooter papers without giving a receipt. Please fix a date for the first ₹5,000 and get everything written down before you agree.",
};
