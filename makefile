CC = em++

# FLAGS DE COMPILAÇÃO
# -O1: Bom equilíbrio para desenvolvimento sem "sumir" com variáveis
CFLAGS = -O1 --bind \
    -s WASM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="'VoxEngine'" \
    -s EXPORTED_FUNCTIONS="['_malloc', '_free']" \
    -s EXPORTED_RUNTIME_METHODS="['ccall', 'cwrap', 'HEAPF32']"

SRC_DIR = core
BUILD_DIR = build
SOURCES = $(SRC_DIR)/dsp_engine.cpp $(SRC_DIR)/pitch_detection.cpp
OUTPUT = $(BUILD_DIR)/vox_engine.js

# DETECÇÃO DE SISTEMA PARA WINDOWS
ifeq ($(OS),Windows_NT)
    MKDIR = if not exist $(BUILD_DIR) mkdir $(BUILD_DIR)
    RM = if exist $(BUILD_DIR) rmdir /s /q $(BUILD_DIR)
else
    MKDIR = mkdir -p $(BUILD_DIR)
    RM = rm -rf $(BUILD_DIR)
endif

all: $(OUTPUT)

$(OUTPUT): $(SOURCES)
	$(MKDIR)
	$(CC) $(CFLAGS) $(SOURCES) -o $(OUTPUT)
	@echo "Build completo: $(OUTPUT)"

clean:
	$(RM)