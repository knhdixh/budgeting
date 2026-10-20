-- Default settings and a starter set of categories. Everything can be renamed or hidden later.
INSERT INTO settings (key, value) VALUES ('base_currency', 'EUR');

INSERT INTO category_groups (id, name, is_income, sort, hidden) VALUES
  ('grp-income', 'Income', 1, 0, 0),
  ('grp-bills', 'Bills', 0, 1, 0),
  ('grp-everyday', 'Everyday', 0, 2, 0),
  ('grp-fun', 'Fun', 0, 3, 0),
  ('grp-goals', 'Goals', 0, 4, 0);

INSERT INTO categories (id, group_id, name, sort, hidden, target_type, target_amount) VALUES
  ('cat-inflow', 'grp-income', 'Ready to assign', 0, 0, 'none', 0),
  ('cat-rent', 'grp-bills', 'Rent', 0, 0, 'none', 0),
  ('cat-utilities', 'grp-bills', 'Utilities', 1, 0, 'none', 0),
  ('cat-phone', 'grp-bills', 'Phone and internet', 2, 0, 'none', 0),
  ('cat-insurance', 'grp-bills', 'Insurance', 3, 0, 'none', 0),
  ('cat-groceries', 'grp-everyday', 'Groceries', 0, 0, 'none', 0),
  ('cat-transport', 'grp-everyday', 'Transport', 1, 0, 'none', 0),
  ('cat-eating-out', 'grp-everyday', 'Eating out', 2, 0, 'none', 0),
  ('cat-household', 'grp-everyday', 'Household', 3, 0, 'none', 0),
  ('cat-health', 'grp-everyday', 'Health', 4, 0, 'none', 0),
  ('cat-entertainment', 'grp-fun', 'Entertainment', 0, 0, 'none', 0),
  ('cat-shopping', 'grp-fun', 'Shopping', 1, 0, 'none', 0),
  ('cat-subscriptions', 'grp-fun', 'Subscriptions', 2, 0, 'none', 0),
  ('cat-emergency', 'grp-goals', 'Emergency fund', 0, 0, 'none', 0),
  ('cat-travel', 'grp-goals', 'Travel', 1, 0, 'none', 0);
