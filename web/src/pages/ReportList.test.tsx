import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ReportList from './ReportList';

test('renders list header and new-entry button', () => {
  render(
    <MemoryRouter>
      <ReportList />
    </MemoryRouter>,
  );
  expect(screen.getByText('报表列表')).toBeTruthy();
  expect(screen.getByRole('link', { name: /新建报表/ })).toBeTruthy();
});
