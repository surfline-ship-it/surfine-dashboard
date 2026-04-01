import "./globals.css";

export const metadata = {
  title: "Surfline Capital — Partner Dashboard",
  description: "Outbound activity dashboard for PE partners",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
