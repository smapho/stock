insert into public.categories (name)
select category_name
from (values ('食料品'), ('OA機器')) as defaults(category_name)
where not exists (
  select 1
  from public.categories
  where categories.name = defaults.category_name
);
