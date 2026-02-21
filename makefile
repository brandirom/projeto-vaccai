CC = em++

# --- ARTEFATOS NA PASTA BUILD ---
OUTPUT_DIR = build
TARGET_JS = $(OUTPUT_DIR)/vaccai_engine.js
TARGET_WASM = $(OUTPUT_DIR)/vaccai_engine.wasm

# --- DESTINO PARA O SITE (PUBLIC) ---
PUBLIC_DIR = public/js

# Flags de Compilação
CFLAGS = -O1 --bind \
	-s WASM=1 \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s MODULARIZE=1 \
	-s EXPORT_NAME="'VaccaiEngine'" \
	-s EXPORTED_FUNCTIONS="['_malloc', '_free']" \
	-s EXPORTED_RUNTIME_METHODS="['ccall', 'cwrap', 'HEAPF32']"

SRC_DIR = core
SOURCES = $(SRC_DIR)/dsp_engine.cpp $(SRC_DIR)/pitch_detection.cpp

# ==============================================================================
# DETECÇÃO DE SISTEMA OPERACIONAL (Windows vs Linux/Mac)
# ==============================================================================
ifeq ($(OS),Windows_NT)
	# --- WINDOWS ---
	MKDIR = if not exist "$(OUTPUT_DIR)" mkdir "$(OUTPUT_DIR)"
	
	# Comando Copy seguro para Windows (converte / para \)
	COPY_CMD = copy /Y
	SRC_JS_WIN = $(subst /,\,$(TARGET_JS))
	DEST_JS_WIN = $(subst /,\,$(PUBLIC_DIR)/vaccai_engine.js)
	SRC_WASM_WIN = $(subst /,\,$(TARGET_WASM))
	DEST_WASM_WIN = $(subst /,\,$(PUBLIC_DIR)/vaccai_engine.wasm)
	
	# Comandos de Limpeza (RM) para Windows
	# 1. Apaga a pasta build inteira
	RM_BUILD = if exist "$(OUTPUT_DIR)" rmdir /s /q "$(OUTPUT_DIR)"
	# 2. Apaga os arquivos específicos na public/js (sem deletar a pasta js inteira)
	# Usamos 'del' e convertemos barras. O '&' permite rodar dois comandos na mesma linha.
	RM_PUBLIC = if exist "$(DEST_JS_WIN)" del /q "$(DEST_JS_WIN)" & \
	            if exist "$(DEST_WASM_WIN)" del /q "$(DEST_WASM_WIN)"

else
	# --- LINUX / MAC ---
	MKDIR = mkdir -p $(OUTPUT_DIR)
	
	# Comando Copy simples
	COPY_CMD = cp
	
	# Comandos de Limpeza (RM) para Linux
	RM_BUILD = rm -rf $(OUTPUT_DIR)
	RM_PUBLIC = rm -f $(PUBLIC_DIR)/vaccai_engine.js $(PUBLIC_DIR)/vaccai_engine.wasm
endif

# ==============================================================================
# REGRAS (TARGETS)
# ==============================================================================

all: $(TARGET_JS)

$(TARGET_JS): $(SOURCES)
	@echo "Criando pasta build..."
	$(MKDIR)
	@echo "Compilando C++ para WebAssembly..."
	$(CC) $(CFLAGS) $(SOURCES) -o $(TARGET_JS)
	@echo "Build compilado em: $(OUTPUT_DIR)"
	
	@echo "Copiando arquivos para o site (public/js)..."
ifeq ($(OS),Windows_NT)
	$(COPY_CMD) "$(SRC_JS_WIN)" "$(DEST_JS_WIN)"
	$(COPY_CMD) "$(SRC_WASM_WIN)" "$(DEST_WASM_WIN)"
else
	$(COPY_CMD) "$(TARGET_JS)" "$(PUBLIC_DIR)/vaccai_engine.js"
	$(COPY_CMD) "$(TARGET_WASM)" "$(PUBLIC_DIR)/vaccai_engine.wasm"
endif
	@echo "Sucesso! Arquivos prontos em $(PUBLIC_DIR)"

clean:
	@echo "Limpando pasta build..."
	$(RM_BUILD)
	@echo "Limpando arquivos gerados na pasta public/js..."
	$(RM_PUBLIC)
	@echo "Limpeza concluida."