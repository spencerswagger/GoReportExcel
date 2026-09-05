import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VersionDrawer } from './VersionDrawer';

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
