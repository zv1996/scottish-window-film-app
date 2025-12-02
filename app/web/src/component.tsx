import React, { useState, useRef } from "react";

type FilmCard = {
  brand: string;
  productName: string;
  type: string;
  priceRange?: string;
  logoUrl?: string;
};

const SAMPLE_DESCRIPTION =
  "heat • glare • residential • living_room • neutral look • mid budget • interior install • high sun • west facing • 180 sq ft • Denver";

const SAMPLE_CARDS: FilmCard[] = [
  {
    brand: "Huper Optik",
    productName: "Ceramic 15",
    type: "solar control",
    priceRange: "$2,520 – $4,320",
    logoUrl: "/film-logos/huper-optik-logo.jpg",
  },
  {
    brand: "Llumar",
    productName: "DL 05G SR CDF - Deluxe",
    type: "solar control",
    priceRange: "$2,520 – $4,320",
    logoUrl: "/film-logos/llumar-logo.jpg",
  },
  {
    brand: "Madico",
    productName: "Amber 81",
    type: "solar control",
    priceRange: "$2,520 – $4,320",
    logoUrl: "/film-logos/madico-logo.jpg",
  },
  {
    brand: "Madico",
    productName: "UV Gard",
    type: "solar control",
    priceRange: "$2,520 – $4,320",
    logoUrl: "/film-logos/madico-logo.jpg",
  },
  {
    brand: "Solar Gard",
    productName: "Quantum Silver Quantum 10",
    type: "solar control",
    priceRange: "$2,520 – $4,320",
    logoUrl: "/film-logos/solar-gard-logo.jpg",
  },
];

const SAMPLE_RAW = {
  description: SAMPLE_DESCRIPTION,
  recommendations: SAMPLE_CARDS,
};

function App() {
  const [cards, setCards] = useState<FilmCard[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelTitle] = useState("Recommended Window Films");
  const [panelDescription, setPanelDescription] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultRaw, setResultRaw] = useState<any | null>(null);
  const [showJson, setShowJson] = useState(false);

  const stripRef = useRef<HTMLDivElement | null>(null);

  const hasCards = cards.length > 0;

  const runSample = () => {
    setLoading(true);
    setError(null);

    // For the dev preview we just load a static sample result.
    // The actual connector uses the tools directly inside ChatGPT.
    setTimeout(() => {
      setCards(SAMPLE_CARDS);
      setPanelDescription(SAMPLE_DESCRIPTION);
      setResultRaw(SAMPLE_RAW);
      setActiveIndex(0);
      setLoading(false);
    }, 150);
  };

  return (
    <div
      style={{
        padding: "2rem",
        fontFamily:
          "system-ui, -apple-system, -sans-serif, Segoe UI, Roboto, sans-serif",
        maxWidth: 960,
        margin: "0 auto",
      }}
    >
      <h1 style={{ marginBottom: 8 }}>Scottish Window Tinting — Dev Preview</h1>
      <p style={{ color: "#666", marginBottom: 16 }}>
        Old form-based intake panel UI is disabled. This page is just a local
        preview of the results carousel UI.
      </p>

      <button
        onClick={runSample}
        disabled={loading}
        style={{
          padding: "0.6rem 1.2rem",
          borderRadius: 999,
          border: "none",
          background: "#0f766e",
          color: "white",
          fontWeight: 600,
          cursor: loading ? "default" : "pointer",
          marginBottom: 24,
        }}
      >
        {loading ? "Running sample..." : "Run sample recommendation"}
      </button>

      {error && (
        <p style={{ color: "crimson", marginTop: 8 }}>Error: {error}</p>
      )}

      {/* Carousel-style results */}
      {hasCards && (
        <div
          style={{
            borderRadius: 16,
            border: "1px solid #e5e7eb",
            padding: 20,
            boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
            marginBottom: 24,
            background: "white",
          }}
        >
          {/* Header */}
          <div
            style={{
              marginBottom: 12,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 8,
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: "1.25rem" }}>{panelTitle}</h2>
              {panelDescription && (
                <p
                  style={{
                    color: "#6b7280",
                    marginTop: 4,
                    marginBottom: 0,
                    fontSize: 14,
                  }}
                >
                  {panelDescription}
                </p>
              )}
            </div>
            {cards.length > 1 && (
              <span style={{ color: "#6b7280", fontSize: 13 }}>
                {activeIndex + 1} / {cards.length}
              </span>
            )}
          </div>

          {/* Card strip, similar to the Pizzaz carousel */}
          <div
            style={{
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
            ref={stripRef}
            style={{
              display: "flex",
              gap: 16,
              overflowX: "auto",
              paddingBottom: 12,
              paddingTop: 12,
              scrollSnapType: "x mandatory",
            }}
          >
              {cards.map((card, i) => (
                <div
                  key={`${card.brand}-${card.productName}-${i}`}
                  style={{
                    minWidth: 260,
                    maxWidth: 260,
                    flex: "0 0 auto",
                    borderRadius: 16,
                    border: "1px solid #e5e7eb",
                    padding: 10,
                    background: "#f9fafb",
                    boxShadow:
                      i === activeIndex
                        ? "0 10px 25px rgba(15,23,42,0.12)"
                        : "0 4px 12px rgba(15,23,42,0.04)",
                    transform:
                      i === activeIndex ? "translateY(-2px)" : "translateY(0)",
                    transition:
                      "box-shadow 120ms ease, transform 120ms ease, border-color 120ms ease",
                    borderColor:
                      i === activeIndex ? "#0f766e" : "rgba(229,231,235,1)",
                    scrollSnapAlign: "start",
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  {/* Logo (fills top), then brand name */}
                  <div
                    style={{
                      marginBottom: 10,
                    }}
                  >
                    {card.logoUrl ? (
                      <div
                        style={{
                          width: "100%",
                          height: 110,
                          borderRadius: 12,
                          border: "1px solid #e5e7eb",
                          background: "white",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: 8,
                          boxSizing: "border-box",
                        }}
                      >
                        <img
                          src={card.logoUrl}
                          alt={card.brand}
                          style={{
                            maxWidth: "100%",
                            maxHeight: "100%",
                            objectFit: "contain",
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: 110,
                          borderRadius: 12,
                          border: "1px dashed #d1d5db",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#9ca3af",
                          fontSize: 10,
                        }}
                      >
                        No logo
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "#6b7280",
                      marginBottom: 4,
                    }}
                  >
                    {card.brand}
                  </div>

                  {/* Product name */}
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      marginBottom: 6,
                      color: "#111827",
                    }}
                  >
                    {card.productName}
                  </div>

                  {/* Type */}
                  <div
                    style={{
                      fontSize: 13,
                      color: "#6b7280",
                      marginBottom: 10,
                    }}
                  >
                    {card.type}
                  </div>

                  {/* Price pill */}
                  {card.priceRange && (
                    <div
                      style={{
                        marginTop: 4,
                        padding: "6px 10px",
                        borderRadius: 999,
                        background: "#81AB4C3D",
                        color: "#166534",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 13,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: 8,
                          height: 8,
                          borderRadius: "999px",
                          background: "#22c55e",
                        }}
                      />
                      <span>Est. installed: </span>
                      <strong>{card.priceRange}</strong>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Carousel controls + dots */}
          {cards.length > 1 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 16,
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() =>
                    setActiveIndex((idx) => {
                      const next = (idx - 1 + cards.length) % cards.length;
                      if (stripRef.current?.children[next]) {
                        (stripRef.current.children[next] as HTMLElement).scrollIntoView({
                          behavior: "smooth",
                          block: "nearest",
                          inline: "start",
                        });
                      }
                      return next;
                    })
                  }
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid #d1d5db",
                    background: "white",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  ◀ Previous
                </button>
                <button
                  onClick={() =>
                    setActiveIndex((idx) => {
                      const next = (idx + 1) % cards.length;
                      if (stripRef.current?.children[next]) {
                        (stripRef.current.children[next] as HTMLElement).scrollIntoView({
                          behavior: "smooth",
                          block: "nearest",
                          inline: "start",
                        });
                      }
                      return next;
                    })
                  }
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid #d1d5db",
                    background: "white",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  Next ▶
                </button>
              </div>

              <div style={{ display: "flex", gap: 4 }}>
                {cards.map((_, i) => (
                  <span
                    key={i}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "999px",
                      background: i === activeIndex ? "#0f766e" : "#d1d5db",
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Raw JSON toggle for debugging */}
      {resultRaw && (
        <div style={{ marginTop: 16 }}>
          <button
            onClick={() => setShowJson((v) => !v)}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px solid #e5e7eb",
              background: "white",
              fontSize: 12,
              cursor: "pointer",
              marginBottom: 8,
            }}
          >
            {showJson ? "Hide raw JSON" : "Show raw JSON"}
          </button>

          {showJson && (
            <pre
              style={{
                background: "#f6f8fa",
                padding: 12,
                borderRadius: 8,
                maxHeight: "55vh",
                overflow: "auto",
                fontSize: 12,
              }}
            >
              {JSON.stringify(resultRaw, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* HMR noise suppressor */}
      {/* eslint-disable-next-line jsx-a11y/aria-role */}
      <div role="presentation" />
    </div>
  );
}

export default App;

import ReactDOM from "react-dom/client";

const rootEl = document.getElementById("root");
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(<App />);
}