import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Datasets from './Datasets';

test('renders data sources and datasets from mock api', async () => {
  render(
    <MemoryRouter>
      <Datasets />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('本地 CSV 目录')).toBeTruthy());
  expect(screen.getByText('数据仓库 PgSQL')).toBeTruthy();
  expect(screen.getByText('销售明细')).toBeTruthy();
  expect(screen.getByText('员工花名册')).toBeTruthy();
  expect(screen.getByText('大区 · string')).toBeTruthy();
});

test('create data source modal opens and can create a csv source', async () => {
  render(
    <MemoryRouter>
      <Datasets />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('本地 CSV 目录')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /新建数据源/ }));
  const input = (await screen.findByPlaceholderText('如：订单 CSV 目录')) as HTMLInputElement;
  fireEvent.change(input, { target: { value: '测试订单目录' } });
  fireEvent.click(screen.getByRole('button', { name: /创\s*建/ }));
  await waitFor(() => expect(screen.getByText('测试订单目录')).toBeTruthy());
  // 新数据源自动携带 orders.csv 表
  expect(screen.getAllByText('orders.csv').length).toBeGreaterThan(0);
});

test('create dataset modal lists sources and can create dataset', async () => {
  render(
    <MemoryRouter>
      <Datasets />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('销售明细')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /新建数据集/ }));
  const input = (await screen.findByPlaceholderText('如：2026 年 9 月订单')) as HTMLInputElement;
  fireEvent.change(input, { target: { value: '季度订单' } });
  // 选择数据源（选中"本地 CSV 目录"对应的选项）
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  const firstOption = await screen.findByText('本地 CSV 目录 · csv_local');
  fireEvent.click(firstOption);
  fireEvent.click(screen.getByRole('button', { name: /创\s*建/ }));
  await waitFor(() => expect(screen.getByText('季度订单')).toBeTruthy());
  // 数据集带订单字段标签
  expect(screen.getByText('订单号 · string')).toBeTruthy();
  expect(screen.getByText('金额 · number')).toBeTruthy();
});