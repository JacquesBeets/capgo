-- https://stackoverflow.com/questions/868620/sql-script-to-alter-all-foreign-keys-to-add-on-delete-cascade
;WITH CTE AS 
( 
  SELECT  
         KCU1.CONSTRAINT_NAME AS FK_CONSTRAINT_NAME 
        ,KCU1.TABLE_SCHEMA AS FK_SCHEMA_NAME 
        ,KCU1.TABLE_NAME AS FK_TABLE_NAME 
        ,KCU1.COLUMN_NAME AS FK_COLUMN_NAME 
        ,KCU1.ORDINAL_POSITION AS FK_ORDINAL_POSITION 
        ,KCU2.CONSTRAINT_NAME AS REFERENCED_CONSTRAINT_NAME 
        ,KCU2.TABLE_SCHEMA AS REFERENCED_SCHEMA_NAME 
        ,KCU2.TABLE_NAME AS REFERENCED_TABLE_NAME 
        ,KCU2.COLUMN_NAME AS REFERENCED_COLUMN_NAME 
        ,KCU2.ORDINAL_POSITION AS REFERENCED_ORDINAL_POSITION 
    FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS RC 

    INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE KCU1 
        ON KCU1.CONSTRAINT_CATALOG = RC.CONSTRAINT_CATALOG  
        AND KCU1.CONSTRAINT_SCHEMA = RC.CONSTRAINT_SCHEMA 
        AND KCU1.CONSTRAINT_NAME = RC.CONSTRAINT_NAME 

    INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE KCU2 
        ON KCU2.CONSTRAINT_CATALOG = RC.UNIQUE_CONSTRAINT_CATALOG  
        AND KCU2.CONSTRAINT_SCHEMA = RC.UNIQUE_CONSTRAINT_SCHEMA 
        AND KCU2.CONSTRAINT_NAME = RC.UNIQUE_CONSTRAINT_NAME 
        AND KCU2.ORDINAL_POSITION = KCU1.ORDINAL_POSITION 
)
SELECT 
     FK_SCHEMA_NAME
    ,FK_TABLE_NAME
    ,FK_CONSTRAINT_NAME 
    --,FK_COLUMN_NAME
    --,REFERENCED_COLUMN_NAME



    ,
    'ALTER TABLE ' || QUOTE_IDENT(FK_SCHEMA_NAME) || '.' || QUOTE_IDENT(FK_TABLE_NAME) || ' ' 
      || 'DROP CONSTRAINT ' || QUOTE_IDENT(FK_CONSTRAINT_NAME) || '; ' 
    AS DropStmt 

    ,
    'ALTER TABLE ' || QUOTE_IDENT(FK_SCHEMA_NAME) || '.' || QUOTE_IDENT(FK_TABLE_NAME) || ' 
    ADD CONSTRAINT ' || QUOTE_IDENT(FK_CONSTRAINT_NAME) || ' 
    FOREIGN KEY(' || string_agg(FK_COLUMN_NAME, ', ') || ') 
'
    || '    REFERENCES ' || QUOTE_IDENT(REFERENCED_SCHEMA_NAME) || '.' || QUOTE_IDENT(REFERENCED_TABLE_NAME) || '(' || string_agg(REFERENCED_COLUMN_NAME, ', ') || ') 
    ON DELETE CASCADE 
; ' AS CreateStmt 

FROM CTE 

GROUP BY 
     FK_SCHEMA_NAME
    ,FK_TABLE_NAME
    ,FK_CONSTRAINT_NAME 

    ,REFERENCED_SCHEMA_NAME
    ,REFERENCED_TABLE_NAME