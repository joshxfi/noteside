// Baseline performance numbers for the per-interaction hot paths. The finder
// hits fuzzy_files + content_search on every keystroke, and scan_notebook runs
// on open / external change — so these are what "highly performant" must hold
// at notebook scale. Run: `cargo bench` (results in target/criterion).
use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use noteside_lib::models::NoteMeta;
use noteside_lib::notebook::{scan_notebook, NoteRecord};
use noteside_lib::search::{content_search, fuzzy_files};
use std::fs;

const WORDS: &[&str] = &[
    "kettle",
    "roadmap",
    "cursor",
    "vim",
    "notebook",
    "lighthouse",
    "design",
    "review",
    "fig",
    "vanilla",
    "morning",
    "pages",
    "keymap",
    "welcome",
    "sync",
    "quarter",
    "offline",
    "markdown",
    "search",
    "backlink",
];
const FOLDERS: &[&str] = &["journal", "work", "ideas", "recipes", "notes"];

fn make_records(n: usize) -> Vec<NoteRecord> {
    (0..n)
        .map(|i| {
            let folder = FOLDERS[i % FOLDERS.len()];
            let path = format!("{}/note-{:05}.md", folder, i);
            let mut body = format!("# Note {}\n\n", i);
            for l in 0..40 {
                let a = WORDS[(i + l) % WORDS.len()];
                let b = WORDS[(i * 3 + l) % WORDS.len()];
                body.push_str(&format!("line {l} about {a} and {b} in the {folder}.\n"));
            }
            NoteRecord {
                meta: NoteMeta {
                    id: path.clone(),
                    path,
                    title: format!("Note {i}"),
                    tags: vec![],
                    created: None,
                    updated: i as i64,
                    pinned: false,
                },
                body,
            }
        })
        .collect()
}

fn bench_search(c: &mut Criterion) {
    let mut g = c.benchmark_group("search");
    g.sample_size(30);
    for &n in &[1_000usize, 10_000, 50_000] {
        let recs = make_records(n);
        g.bench_with_input(BenchmarkId::new("fuzzy_files", n), &recs, |b, recs| {
            b.iter(|| fuzzy_files(recs, "roadmap", 50))
        });
        g.bench_with_input(BenchmarkId::new("content_plain", n), &recs, |b, recs| {
            b.iter(|| content_search(recs, "lighthouse", "plain", 200).unwrap())
        });
        // worst case: a rare term that never hits the 200 limit → full scan
        g.bench_with_input(BenchmarkId::new("content_nomatch", n), &recs, |b, recs| {
            b.iter(|| content_search(recs, "qqzzxxnotpresent", "plain", 200).unwrap())
        });
        g.bench_with_input(BenchmarkId::new("content_regex", n), &recs, |b, recs| {
            b.iter(|| content_search(recs, r"road\w+", "regex", 200).unwrap())
        });
    }
    g.finish();
}

fn bench_scan(c: &mut Criterion) {
    let mut g = c.benchmark_group("scan");
    g.sample_size(10);
    for &n in &[1_000usize, 10_000] {
        let dir = std::env::temp_dir().join(format!("noteside-bench-{n}"));
        let _ = fs::remove_dir_all(&dir);
        for r in make_records(n) {
            let p = dir.join(&r.meta.path);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, &r.body).unwrap();
        }
        g.bench_with_input(BenchmarkId::new("scan_notebook", n), &dir, |b, dir| {
            b.iter(|| scan_notebook(dir))
        });
        let _ = fs::remove_dir_all(&dir);
    }
    g.finish();
}

criterion_group!(benches, bench_search, bench_scan);
criterion_main!(benches);
