# Disk Analyzer

App desktop per Windows 11 che scansiona un'unità o una cartella, in sola lettura, e mostra cosa
occupa spazio: albero delle cartelle, treemap, file più grandi e ripartizione per tipo.

Tauri 2 + Rust (scansione) + React/TypeScript (interfaccia). Documentazione di progetto:
[`PRD.md`](PRD.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`DESIGN.md`](DESIGN.md), [`TASKS.md`](TASKS.md).

Oltre ai dischi, la sezione **App installate** (nella sidebar) elenca le app desktop di Windows e
misura quanto pesano le loro cartelle.

## Prerequisiti

- Node.js 20+ e npm
- Rust (toolchain MSVC) e i Visual Studio Build Tools con il workload "Sviluppo desktop con C++"
- WebView2 (già presente su Windows 11)

## Comandi

| Comando                  | Cosa fa                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `npm install`            | Installa le dipendenze del frontend                             |
| `npm run tauri dev`      | Avvia l'app in sviluppo (ricarica a ogni modifica)              |
| `npm run tauri build`    | Compila l'app e crea l'installer in `src-tauri/target/release/bundle` |
| `npm test`               | Test del frontend (Vitest)                                      |
| `cargo test`             | Test del core Rust, da `src-tauri/`; rigenera anche `src/bindings` |
| `npm run lint`           | ESLint                                                          |
| `npm run format:check`   | Prettier (usa `npm run format` per correggere)                  |
| `cargo clippy --all-targets` | Lint del core Rust, da `src-tauri/`                         |

Il frontend funziona solo dentro Tauri: le scansioni e i dati arrivano dal core Rust, non c'è una
modalità solo-browser.

## Note

- **Compilazione:** `src-tauri/.cargo/config.toml` limita Cargo a 3 job paralleli. Senza, su PC con
  poca RAM libera `rustc` può terminare con `out of memory` (succedeva su `tokio`). Gli errori
  `memory allocation … failed` e, a catena, `only metadata stub found for rlib dependency core`
  indicano esaurimento del *commit* di Windows (non solo della RAM). Se capita ancora, chiudi
  programmi pesanti e usa `CARGO_BUILD_JOBS=1` (più lento: da zero circa 10 minuti, picco ~2 GB per
  compilatore). Le dipendenze si compilano senza informazioni di debug (`Cargo.toml`).
- **Tipi condivisi:** i tipi in `src/bindings/` sono generati da `ts-rs` a partire da
  `src-tauri/src/model.rs`; non vanno modificati a mano. Se cambi il modello Rust, esegui `cargo test`.
- **Log:** `%LOCALAPPDATA%\com.personal.diskanalyzer\logs\`. Il livello si cambia con la variabile
  d'ambiente `RUST_LOG` (es. `RUST_LOG=debug`).
- **Icona:** il sorgente è `design/icon.svg`; si rigenerano i formati con `npx tauri icon <png 1024>`.
