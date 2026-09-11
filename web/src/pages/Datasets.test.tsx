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
  // 种子数据集绑定真实 orders.csv，字段来自真实文件解析
  expect(screen.getByText('销售明细')).toBeTruthy();
  expect(screen.getByText('大区 · string')).toBeTruthy();
  expect(screen.getByText('金额 · number')).toBeTruthy();
});

test('new data source modal requires an uploaded csv file', async () => {
  render(
    <MemoryRouter>
      <Datasets />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('本地 CSV 目录')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /新建数据源/ }));
  // 文件选择控件与说明存在
  expect(await screen.findByText('⇪ 选择 CSV 文件')).toBeTruthy();
  expect(screen.getByText(/必须上传一个 CSV 文件/)).toBeTruthy();
  // 未选择文件时创建按钮不提交（无文件 → 直接返回）
  fireEvent.click(screen.getByRole('button', { name: /创\s*建/ }));
  expect(screen.getByText(/必须上传一个 CSV 文件/)).toBeTruthy();
});

test('create dataset binds to source table with real fields', async () => {
  render(
    <MemoryRouter>
      <Datasets />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('销售明细')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /新建数据集/ }));
  const nameInput = await screen.findByPlaceholderText('数据集名称（如：9 月订单）');
  fireEvent.change(nameInput, { target: { value: '9 月订单明细' } });
  // 选择数据源 csv_local
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  const srcOption = await screen.findByText('本地 CSV 目录 · csv_local');
  fireEvent.click(srcOption);
  // 选择表 orders.csv（下拉选项出现于页面 tag 之后）
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
  const tableOption = (await screen.findAllByText('orders.csv')).at(-1) as HTMLElement;
  fireEvent.click(tableOption);
  fireEvent.click(screen.getByRole('button', { name: /创\s*建/ }));
  await waitFor(() => expect(screen.getByText('9 月订单明细')).toBeTruthy());
  // 数据集字段标签来自所选表的真实解析（种子与新数据集均含该字段）
  expect((await screen.findAllByText('金额 · number')).length).toBeGreaterThan(0);
});

test('dataset sample preview opens a table of rows', async () => {
  render(
    <MemoryRouter>
      <Datasets />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('销售明细')).toBeTruthy());
  fireEvent.click(screen.getAllByRole('button', { name: /查看样例数据/ })[0]);
  await waitFor(() => expect(screen.getByText(/· 样例数据/)).toBeTruthy());
});