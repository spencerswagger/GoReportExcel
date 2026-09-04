import { render, screen } from '@testing-library/react';
import PreviewCanvas from './PreviewCanvas';
import { fixtureSchema } from '../api/mock';

test('renders header and body rows from schema', () => {
  render(<PreviewCanvas schema={fixtureSchema as unknown as Parameters<typeof PreviewCanvas>[0]['schema']} />);
  expect(screen.getByText('大区')).toBeTruthy();
  expect(screen.getAllByText(/华东/).length).toBeGreaterThan(0);
  expect(screen.getByText('=SUBTOTAL(9,C2:C3)')).toBeTruthy();
});

test('emits style tags from schema dict', () => {
  const { container } = render(
    <PreviewCanvas schema={fixtureSchema as unknown as Parameters<typeof PreviewCanvas>[0]['schema']} />,
  );
  expect(container.querySelector('style')?.textContent).toContain('.st-');
});
