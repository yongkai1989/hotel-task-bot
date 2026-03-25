export const metadata = {
  title: 'Hotel Task Dashboard',
  description: 'Mobile-friendly hotel task dashboard'
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f7f7f7', fontFamily: 'Arial, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
