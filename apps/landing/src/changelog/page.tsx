import { RELEASES, useChangelog } from "../changelog";
import type { ChangelogEntry } from "../changelog";
import { SiteFooter, SiteHeader } from "../chrome";
import { useHead } from "../head";

const eyebrow = "font-mono text-[12.5px] tracking-[0.16em] uppercase text-accent mb-3.5";

const fmtDate = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" }).format(
        new Date(iso),
      )
    : "";

function Entry({ entry }: { entry: ChangelogEntry }) {
  return (
    <article className="border-t border-rule-soft py-11 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="font-serif text-[2rem] font-medium tracking-[-0.02em]">{entry.version}</h2>
        <time className="font-mono text-[13px] text-ink-faint">{fmtDate(entry.date)}</time>
        <a
          className="ml-auto font-mono text-[12.5px] text-ink-soft underline underline-offset-2 hover:text-accent"
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on GitHub ↗
        </a>
      </div>
      {entry.sections.map((section) => (
        <div className="mt-6" key={section.title}>
          <h3 className="mb-2.5 font-mono text-[11.5px] tracking-[0.13em] uppercase text-accent">
            {section.title}
          </h3>
          <ul className="flex flex-col gap-2">
            {section.items.map((item) => (
              <li
                className="text-[1.02rem] leading-[1.5] text-ink-soft text-pretty"
                key={item.commit?.hash ?? item.text}
              >
                {item.scope && <span className="font-semibold text-ink">{item.scope}: </span>}
                {item.text}
                {item.commit && (
                  <>
                    {" "}
                    <a
                      className="font-mono text-[12px] text-ink-faint underline underline-offset-2 hover:text-accent"
                      href={item.commit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.commit.hash}
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </article>
  );
}

export function ChangelogPage() {
  useHead("Changelog — Noteside", "https://noteside.app/changelog");
  const { entries, status } = useChangelog();
  return (
    <>
      <SiteHeader />
      <main className="wrap min-h-[60vh] pt-[72px] pb-24 max-sm:pt-12">
        <div className="mb-12 text-center">
          <p className={eyebrow}>Changelog</p>
          <h1 className="font-serif text-[clamp(2.2rem,5vw,3.2rem)] font-medium leading-[1.08] tracking-[-0.02em] text-balance">
            What's new in Noteside
          </h1>
        </div>

        {status === "loading" && (
          <p className="py-16 text-center font-mono text-[13px] text-ink-faint">
            Loading releases…
          </p>
        )}
        {status === "error" && (
          <p className="py-16 text-center font-mono text-[13px] text-ink-faint">
            Couldn't load releases.{" "}
            <a
              className="underline underline-offset-2 hover:text-accent"
              href={RELEASES}
              target="_blank"
              rel="noopener noreferrer"
            >
              View them on GitHub ↗
            </a>
          </p>
        )}
        {status === "ready" && (
          <div className="mx-auto max-w-[52rem]">
            {entries.map((entry) => (
              <Entry entry={entry} key={entry.version} />
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
