interface ButtonProps {
  label: string;
  variant?: "primary" | "secondary";
  onClick?: () => void;
}

export function Button({ label, variant = "primary", onClick }: ButtonProps) {
  const style: React.CSSProperties = {
    fontFamily: "system-ui, sans-serif",
    fontSize: 14,
    padding: "8px 16px",
    borderRadius: 6,
    border: variant === "primary" ? "none" : "1px solid #ccc",
    background: variant === "primary" ? "#2b7fff" : "#ffffff",
    color: variant === "primary" ? "#ffffff" : "#09090b",
    cursor: "pointer",
  };
  return (
    <button type="button" style={style} onClick={onClick}>
      {label}
    </button>
  );
}
