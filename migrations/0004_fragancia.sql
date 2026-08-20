-- Ficha olfativa en la base, no en el código.
--
-- Hasta ahora la familia y las notas vivían en un archivo de la tienda
-- (src/data/productNotes.js) indexado por ProductoID. Eso significa que un
-- perfume agregado desde el panel se publicaba sin notas: no salía su pirámide
-- en la ficha ni aparecía al buscar «vainilla» o «amaderado», hasta que
-- alguien editara código y desplegara.
--
-- Con esto, agregar una fragancia desde el panel la deja completa.
ALTER TABLE Productos ADD COLUMN Familia TEXT;
ALTER TABLE Productos ADD COLUMN NotasSalida TEXT;
ALTER TABLE Productos ADD COLUMN NotasCorazon TEXT;
ALTER TABLE Productos ADD COLUMN NotasFondo TEXT;

-- Las notas se guardan separadas por coma: son listas cortas que solo se leen
-- completas, y una tabla aparte obligaría a un join en cada consulta del
-- catálogo para mostrar tres líneas de texto.
