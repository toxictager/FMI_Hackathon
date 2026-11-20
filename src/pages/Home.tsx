import { useNavigate } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { SAMPLE_CITIES } from "@/lib/bulgaria-data";
import { Header, Footer } from "@/components/SiteChrome";
import { useDocumentMeta } from "@/lib/useDocumentMeta";

const CITIES = Array.from(SAMPLE_CITIES, (k) =>
  k.replace(/\b\w/g, (c) => c.toUpperCase()),
);

export default function Home() {
  useDocumentMeta(
    "Routique — Plan trips across Bulgaria",
    "Compare the fastest, cheapest and most convenient routes across Bulgaria by bus, train or car.",
  );
  const navigate = useNavigate();
  const [from, setFrom] = useState("Sofia");
  const [to, setTo] = useState("Plovdiv");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!from.trim() || !to.trim()) return;
    const params = new URLSearchParams({ from: from.trim(), to: to.trim() });
    navigate(`/results?${params.toString()}`);
  };


  return (
    <main className="flex min-h-screen flex-col bg-background">
      <Header />

      <div className="flex flex-1 flex-col justify-center">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 -z-10 opacity-[0.08]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, var(--primary) 0, transparent 40%), radial-gradient(circle at 80% 30%, var(--secondary) 0, transparent 45%), radial-gradient(circle at 50% 90%, var(--accent) 0, transparent 50%)",
          }}
        />
        <div className="mx-auto max-w-4xl px-6 pt-12 pb-10 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Plan smarter trips across Bulgaria
          </span>
          <h1 className="mt-6 font-display text-5xl font-extrabold leading-[1.05] text-foreground sm:text-7xl">
            From the Black Sea
            <br />
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-warm)" }}>
              to the Rila peaks.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground sm:text-lg">
            Compare the fastest, cheapest, and most convenient ways to get anywhere in the country — bus, train, or car.
          </p>
        </div>
      </section>

      {/* Search */}
      <section className="mx-auto max-w-4xl px-6">
        <form
          onSubmit={onSubmit}
          className="rounded-3xl border border-border bg-card p-3 sm:p-4"
          style={{ boxShadow: "var(--shadow-elegant)" }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <CityInput label="From" value={from} onChange={setFrom} accentDot="bg-primary" />
            <CityInput label="To" value={to} onChange={setTo} accentDot="bg-secondary" />
            <button
              type="submit"
              className="group inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl px-6 py-4 font-semibold text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.99]"
              style={{ background: "var(--gradient-hero)" }}
            >
              Find Routes
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        </form>
      </section>
      </div>

      <Footer />
    </main>
  );
}

function CityInput({
  label, value, onChange, accentDot,
}: { label: string; value: string; onChange: (v: string) => void; accentDot: string }) {
  const listId = `cities-${label}`;
  return (
    <label className="group relative flex items-center gap-3 rounded-2xl bg-muted/60 px-4 py-3 transition-colors focus-within:bg-muted">
      <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${accentDot}`} />
      <span className="flex flex-1 flex-col">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <input
          list={listId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="City in Bulgaria"
          className="bg-transparent text-base font-medium text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
        <datalist id={listId}>
          {CITIES.map((c) => <option key={c} value={c} />)}
        </datalist>
      </span>
    </label>
  );
}
