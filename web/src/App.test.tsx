import { render, screen } from '@testing-library/react';
import App from './App';

test('renders shell', () => {
  render(<App />);
  expect(screen.getByText((_, el) => el?.textContent === 'GoReportExcel')).toBeTruthy();
  expect(screen.getByText('报表库')).toBeTruthy();
  expect(screen.getAllByText(/报表列表/).length).toBeGreaterThan(0);
});