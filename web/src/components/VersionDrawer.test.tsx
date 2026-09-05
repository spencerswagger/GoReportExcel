import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { VersionDrawer } from './VersionDrawer';
import { server } from '../api/mock';

test('opens and lists versions from api', async () => {
  render(<VersionDrawer defId="r1" />);
  fireEvent.click(screen.getByRole('button', { name: /历史版本/ }));
  await waitFor(() => {
    expect(screen.getByText(/v2 · published/)).toBeTruthy();
  });
  expect(screen.getByText(/v1 · draft/)).toBeTruthy();
});

test('rollback button calls api and shows confirmation', async () => {
  render(<VersionDrawer defId="r1" />);
  fireEvent.click(screen.getByRole('button', { name: /历史版本/ }));
  await waitFor(() => expect(screen.getByText(/v2 · published/)).toBeTruthy());
  fireEvent.click(screen.getAllByRole('button', { name: /回\s*滚/ })[0]);
  await waitFor(() => {
    expect(screen.getByText(/已回滚/)).toBeTruthy();
  });
});

test('shows error when rollback fails', async () => {
  server.use(
    http.post('*/api/v1/definitions/:id/rollback', () =>
      HttpResponse.json({ error: 'boom' }, { status: 500 }),
    ),
  );
  render(<VersionDrawer defId="r1" />);
  fireEvent.click(screen.getByRole('button', { name: /历史版本/ }));
  await waitFor(() => expect(screen.getByText(/v2 · published/)).toBeTruthy());
  fireEvent.click(screen.getAllByRole('button', { name: /回\s*滚/ })[0]);
  await waitFor(() => {
    expect(screen.getByText('回滚失败')).toBeTruthy();
  });
});
