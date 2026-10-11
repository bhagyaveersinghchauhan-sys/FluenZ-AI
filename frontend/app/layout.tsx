import type { Metadata } from 'next';
import '@livekit/components-styles';
import './styles.css';
import './finish.css';

export const metadata: Metadata = {
  title: 'FluenZ — बोलकर सीखें',
  description: 'बोलकर अंग्रेज़ी सीखें।',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="hi"><body>{children}</body></html>;
}
