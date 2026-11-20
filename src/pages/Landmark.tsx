import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Clock, Ticket, CalendarHeart, ExternalLink, MapPin, Lightbulb, Info, BookOpen } from "lucide-react";
import { LANDMARKS, WikiLandmarkSummary, getWikiLandmarkSummary, getWikiLandmarkImage } from "@/lib/bulgaria-data";
import { Header, Footer } from "@/components/SiteChrome";
import { useDocumentMeta } from "@/lib/useDocumentMeta";
import NotFound from "./NotFound";

export default function LandmarkPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const queryString = searchParams.toString();
  const l = LANDMARKS.find((x) => x.slug === slug);

  useDocumentMeta(
    "Routique",
    l ? `${l.description} Hours, ticket prices and travel tips for ${l.name}.` : "Landmark details on Routique.",
  );

  if (!l) return <NotFound />;

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [wikiData, setWikiData] = useState<WikiLandmarkSummary | null>(null);

  useEffect(() => {
    let isMounted = true;

    getWikiLandmarkImage(l.name)
      .then((url) => {
        if (isMounted) setImageUrl(url);
      })
      .catch(() => {
        if (isMounted) setImageUrl(null);
      });

    return () => {
      isMounted = false;
    };
  }, [l.name]);

  useEffect(() => {
    let isMounted = true;

    getWikiLandmarkSummary(l.name)
      .then((wiki) => {
        if (isMounted) setWikiData(wiki);
      })
      .catch(() => {
        if (isMounted) setWikiData(null);
      });

    return () => {
      isMounted = false;
    };
  }, [l.name]);

  const lat = wikiData?.lat ?? l.lat;
  const lng = wikiData?.lng ?? l.lng;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <br />

      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden="true"
          className="absolute inset-0 scale-110 bg-cover bg-center"
          style={{
            backgroundImage: imageUrl ? `url("${imageUrl}")` : "var(--gradient-warm)",
            filter: "blur(0px)",
          }}
        />
        <div className="relative z-10">
          <div className="container mx-auto px-10 pt-8 pb-26">
            <div
              className={
                imageUrl
                  ? "w-fit rounded-full bg-background/70 px-4 py-2 shadow-lg backdrop-blur-sm"
                  : undefined
              }
            >
              <Link to={queryString ? `/results?${queryString}` : "/"} className={`inline-flex items-center gap-2 text-sm font-semibold underline-offset-4 text-foreground/80 hover:underline hover:text-underline`}>
                <ArrowLeft className="h-4 w-4" /> Back to search
              </Link>
            </div>
          </div>
          <div className={`container mx-auto px-10 pb-40 ${imageUrl ? "text-white" : ""}`}>
            <div className="mt-6 flex items-start gap-5">
              {!imageUrl && <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-3xl bg-background/70 text-6xl shadow-lg">
                <span aria-hidden>{l.emoji}</span>
              </div>}
              <div
                className={
                  imageUrl
                    ? "px-8 py-6 rounded-3xl bg-background/70 shadow-lg"
                    : undefined
                }
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">
                  <MapPin className="mr-1 inline h-3 w-3" />{l.city}
                </p>
                <h1 className="mt-1 font-display text-4xl font-bold text-foreground md:text-5xl">{l.name}</h1>
                <p className="text-[25px] mt-3 max-w-2xl text-base text-foreground/80">{l.description}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <article
              className="rounded-2xl border border-border bg-card p-6"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-foreground">
                <Info className="h-5 w-5 text-primary" /> About
              </h2>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">{l.longDescription}</p>
            </article>

            {wikiData && <article
              className="rounded-2xl border border-border bg-card p-6"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-foreground">
                <BookOpen className="h-5 w-5 text-primary" /> Wiki
              </h2>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">{wikiData.longDescription}</p>
              <a className="hover:underline hover:text-underline" href={`https://en.wikipedia.org/wiki/${encodeURIComponent(l.name)}`} target="_blank">Read more...</a>
            </article>}

            {l.tips && l.tips.length > 0 && (
              <article
                className="rounded-2xl border border-border bg-card p-6"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-foreground">
                  <Lightbulb className="h-5 w-5 text-primary" /> Travel tips
                </h2>
                <ul className="mt-3 space-y-2">
                  {l.tips.map((tip: string) => (
                    <li key={tip} className="flex gap-3 text-sm text-muted-foreground">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </article>
            )}
          </div>

          <aside className="space-y-4">
            <InfoCard icon={Clock} label="Opening hours" value={l.hours} />
            <InfoCard icon={Ticket} label="Tickets & fees" value={l.ticketPrice} />
            <InfoCard icon={CalendarHeart} label="Best time to visit" value={l.bestTime} />

            <a
              href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <span className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Open in Google Maps</span>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </a>

            {l.website && (
              <a
                href={l.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <span>Official website</span>
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </aside>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-4"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-2 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
