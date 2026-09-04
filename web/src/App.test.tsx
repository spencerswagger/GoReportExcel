import { render, screen } from '@testing-library/react';
import App from './App';

test('renders shell', () => {
  render(<App />);
  expect(screen.getByText('GoReportExcel 报表管理端')).toBeTruthy();
  expect(screen.getAllByText(/报表列表/).length).toBeGreaterThan(0);
});
